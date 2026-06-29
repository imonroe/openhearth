/**
 * TmdbProvider — the TMDB implementation of {@link MetadataProvider} (FR-B1).
 *
 * Uses the user's own v3 API key (from `metadata.tmdbApiKey`) and sends only the
 * search query, language, year, and a fixed `include_adult=false` — no identity
 * or telemetry ever leaves the host beyond the lookup itself (NFR-9). TMDB
 * response shapes are mapped to the neutral {@link MetadataResult} here so no
 * TMDB specifics leak past the interface.
 *
 * Requests are serialized through a small min-interval throttle (TMDB is
 * generous but not unlimited) and a single Retry-After-aware retry on HTTP 429.
 * `fetch` and `sleep` are injectable so unit tests run fully offline and without
 * real delays.
 */
import type {
  MetadataProvider,
  MetadataQuery,
  MetadataResult,
  MetadataKind,
  MetadataCastMember,
} from './MetadataService.js';

const API_BASE = 'https://api.themoviedb.org/3';
/** Well-known TMDB image CDN base (avoids a /configuration round-trip). */
const IMAGE_BASE = 'https://image.tmdb.org/t/p';
const POSTER_SIZE = 'w500';
const BACKDROP_SIZE = 'w1280';
const PROFILE_SIZE = 'w185';
/** Cap principal cast so a details payload stays small. */
const CAST_LIMIT = 12;
/** Minimum gap between outbound requests (~25 req/s; well under TMDB limits). */
const DEFAULT_MIN_INTERVAL_MS = 40;

export interface TmdbProviderOptions {
  apiKey: string;
  language?: string;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Override the inter-request gap (tests set this to 0). */
  minIntervalMs?: number;
}

interface TmdbCastRecord {
  name?: string;
  character?: string;
  profile_path?: string | null;
}
interface TmdbCrewRecord {
  name?: string;
  job?: string;
}

/** A single TMDB search/details record (only the fields we map). */
interface TmdbRecord {
  id: number;
  title?: string; // movie
  name?: string; // tv
  release_date?: string; // movie (YYYY-MM-DD)
  first_air_date?: string; // tv
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  // Details-only fields (present on /movie/{id} and /tv/{id}, not on search).
  runtime?: number | null; // movie (minutes)
  episode_run_time?: number[]; // tv (minutes per episode)
  genres?: { id: number; name?: string }[];
  tagline?: string | null;
  vote_average?: number;
  credits?: { cast?: TmdbCastRecord[]; crew?: TmdbCrewRecord[] };
}

interface TmdbSearchResponse {
  results?: TmdbRecord[];
}

export class TmdbProvider implements MetadataProvider {
  readonly name = 'tmdb';

  private readonly apiKey: string;
  private readonly language: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minIntervalMs: number;
  /** Tail of the request queue — chains calls so they run one at a time. */
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(opts: TmdbProviderOptions) {
    this.apiKey = opts.apiKey;
    this.language = opts.language ?? 'en-US';
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.minIntervalMs = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  }

  async search(query: MetadataQuery): Promise<MetadataResult[]> {
    const title = query.title.trim();
    if (!title) return [];
    // With a kind hint, search just that endpoint; otherwise search both and
    // interleave so the caller's ranking sees movie + tv candidates.
    const kinds: MetadataKind[] = query.kind ? [query.kind] : ['movie', 'tv'];
    const perKind = await Promise.all(kinds.map((k) => this.searchKind(k, title, query.year)));
    return interleave(perKind);
  }

  async details(ref: string): Promise<MetadataResult | null> {
    const parsed = parseRef(ref);
    if (!parsed) return null;
    const { kind, id } = parsed;
    const path = kind === 'movie' ? `/movie/${id}` : `/tv/${id}`;
    // append_to_response folds the credits call into one request (FR-B1 spirit:
    // one round-trip per details lookup), so cast/crew arrive without a second hit.
    const record = await this.request<TmdbRecord>(path, { append_to_response: 'credits' });
    if (!record || typeof record.id !== 'number') return null;
    return toResult(this.name, kind, record);
  }

  private async searchKind(
    kind: MetadataKind,
    title: string,
    year: number | null | undefined,
  ): Promise<MetadataResult[]> {
    const path = kind === 'movie' ? '/search/movie' : '/search/tv';
    const params: Record<string, string> = { query: title };
    if (year != null) {
      // Movie uses `year`; TV uses `first_air_date_year`.
      params[kind === 'movie' ? 'year' : 'first_air_date_year'] = String(year);
    }
    const body = await this.request<TmdbSearchResponse>(path, params);
    const records = body?.results ?? [];
    return (
      records
        .filter((r) => typeof r.id === 'number')
        .map((r) => toResult(this.name, kind, r))
        // Drop records with no usable title rather than emitting an empty one.
        .filter((r): r is MetadataResult => r !== null)
    );
  }

  /** Build the URL, run it through the throttle, and parse JSON. */
  private request<T>(path: string, params: Record<string, string>): Promise<T | null> {
    const url = new URL(API_BASE + path);
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('language', this.language);
    url.searchParams.set('include_adult', 'false');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return this.enqueue(() => this.fetchJson<T>(url.toString()));
  }

  /** Serialize requests and enforce the min inter-request interval. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.minIntervalMs - (this.monotonicNow() - this.lastRequestAt);
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = this.monotonicNow();
      return task();
    });
    // Keep the chain alive even if a task rejects (don't poison later requests).
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private monotonicNow(): number {
    // Monotonic clock: immune to wall-clock jumps that could skew the interval.
    return performance.now();
  }

  private async fetchJson<T>(url: string): Promise<T | null> {
    let res = await this.fetchImpl(url);
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after')) || 1;
      await this.sleep(retryAfter * 1000);
      res = await this.fetchImpl(url);
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`TMDB request failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }
}

/** `tmdb:movie:603` → { kind: 'movie', id: '603' }; null when malformed. */
function parseRef(ref: string): { kind: MetadataKind; id: string } | null {
  const parts = ref.split(':');
  if (parts.length !== 3 || parts[0] !== 'tmdb') return null;
  const kind = parts[1];
  const id = parts[2];
  if ((kind !== 'movie' && kind !== 'tv') || !id) return null;
  return { kind, id };
}

/** Map a TMDB record to the neutral result shape; null if it has no usable title. */
function toResult(provider: string, kind: MetadataKind, r: TmdbRecord): MetadataResult | null {
  const title = ((kind === 'movie' ? r.title : r.name) ?? r.name ?? r.title ?? '').trim();
  if (!title) return null;
  const date = kind === 'movie' ? r.release_date : r.first_air_date;
  const year = yearOf(date);
  const poster = r.poster_path ? `${IMAGE_BASE}/${POSTER_SIZE}${r.poster_path}` : undefined;
  const backdrop = r.backdrop_path ? `${IMAGE_BASE}/${BACKDROP_SIZE}${r.backdrop_path}` : undefined;

  // Details-only fields (absent on search records → these all stay undefined).
  const runtimeRaw = kind === 'movie' ? r.runtime : r.episode_run_time?.[0];
  const runtime =
    typeof runtimeRaw === 'number' && runtimeRaw > 0 ? Math.round(runtimeRaw) : undefined;
  const genres = r.genres?.map((g) => g.name?.trim()).filter((n): n is string => !!n);
  const cast = r.credits?.cast
    ?.slice(0, CAST_LIMIT)
    .map((c): MetadataCastMember | null => {
      const name = c.name?.trim();
      if (!name) return null;
      const character = c.character?.trim();
      const profile = c.profile_path ? `${IMAGE_BASE}/${PROFILE_SIZE}${c.profile_path}` : undefined;
      return {
        name,
        ...(character ? { character } : {}),
        ...(profile ? { profile_url: profile } : {}),
      };
    })
    .filter((c): c is MetadataCastMember => c !== null);
  const directors = r.credits?.crew
    ?.filter((c) => c.job === 'Director')
    .map((c) => c.name?.trim())
    .filter((n): n is string => !!n);
  const tagline = r.tagline?.trim() || undefined;
  const rating =
    typeof r.vote_average === 'number' && r.vote_average > 0
      ? Math.round(r.vote_average * 10) / 10
      : undefined;

  return {
    ref: `${provider}:${kind}:${r.id}`,
    kind,
    title,
    ...(year != null ? { year } : {}),
    ...(r.overview ? { overview: r.overview } : {}),
    artwork: {
      ...(poster ? { poster_url: poster } : {}),
      ...(backdrop ? { backdrop_url: backdrop } : {}),
    },
    ...(runtime != null ? { runtime_minutes: runtime } : {}),
    ...(genres && genres.length > 0 ? { genres } : {}),
    ...(cast && cast.length > 0 ? { cast } : {}),
    ...(directors && directors.length > 0 ? { directors } : {}),
    ...(tagline ? { tagline } : {}),
    ...(rating != null ? { rating } : {}),
  };
}

function yearOf(date: string | undefined): number | undefined {
  if (!date) return undefined;
  const y = Number(date.slice(0, 4));
  return Number.isFinite(y) && y > 0 ? y : undefined;
}

/** Round-robin merge of several ranked lists, preserving each list's order. */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i] as T);
    }
  }
  return out;
}
