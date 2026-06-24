/**
 * MetadataService — pluggable metadata lookup (Strategy B foundation; FR-B1).
 *
 * The brain resolves artwork/metadata for library items (and, later, service
 * tiles) through a {@link MetadataProvider}. TMDB is the first provider, but no
 * TMDB specifics leak through this interface — callers see only the neutral
 * {@link MetadataResult} shape, so a second provider can drop in without changing
 * anything upstream (FR-B1 acceptance: "provider is swappable behind the
 * interface").
 *
 * The service is always constructed, even with no provider configured: in that
 * case `enabled` is false and lookups return empty/null so the app stays fully
 * usable with no key (NFR-9 / §13.2 graceful degradation). The normalized media
 * model in `shared/models` and the cache layer land in #40/#41; this issue is
 * the provider seam and the TMDB client (#39).
 */
import type { MetadataConfig, MediaItem, MediaKind } from '@openhearth/shared';
import { TmdbProvider } from './TmdbProvider.js';

/** What kind of title a result describes. */
export type MetadataKind = 'movie' | 'tv';

/** A metadata lookup request, derived from a library item's naming. */
export interface MetadataQuery {
  title: string;
  /** Release/first-air year, when known — narrows the match. */
  year?: number | null;
  /** Optional hint; when omitted the provider may search both movie and tv. */
  kind?: MetadataKind;
}

/** Resolved artwork URLs (absolute, provider-hosted). */
export interface MetadataArtwork {
  poster_url?: string;
  backdrop_url?: string;
}

/**
 * A provider-agnostic metadata result. `ref` is an opaque, round-trippable
 * handle (`<provider>:<kind>:<id>`) that {@link MetadataProvider.details} accepts;
 * callers never parse it.
 */
export interface MetadataResult {
  ref: string;
  kind: MetadataKind;
  title: string;
  year?: number | null;
  overview?: string;
  artwork: MetadataArtwork;
}

/** The seam every metadata provider implements. No provider specifics leak out. */
export interface MetadataProvider {
  /** Stable provider name (e.g. `tmdb`), used to namespace `ref`s. */
  readonly name: string;
  /** Search by title (+ optional year/kind). Ordered best-first by the provider. */
  search(query: MetadataQuery): Promise<MetadataResult[]>;
  /** Fetch full details for a `ref` returned by {@link search}; null if unknown. */
  details(ref: string): Promise<MetadataResult | null>;
}

/**
 * Project a provider {@link MetadataResult} into the shared normalized
 * {@link MediaItem} (#40). The opaque `ref` (`<provider>:<kind>:<id>`) becomes
 * both the item id and a `{ [provider]: id }` external-id entry, so a second
 * provider contributes ids without any model change. `tv` maps to the
 * provider-agnostic `series` kind.
 */
export function mediaItemFromMetadata(result: MetadataResult): MediaItem {
  const [provider, , externalId] = result.ref.split(':');
  const kind: MediaKind = result.kind === 'tv' ? 'series' : 'movie';
  const artwork: MediaItem['artwork'] = {
    ...(result.artwork.poster_url ? { poster_url: result.artwork.poster_url } : {}),
    ...(result.artwork.backdrop_url ? { backdrop_url: result.artwork.backdrop_url } : {}),
  };
  return {
    id: result.ref,
    title: result.title,
    kind,
    ...(result.year != null ? { year: result.year } : {}),
    ...(result.overview ? { overview: result.overview } : {}),
    ...(Object.keys(artwork).length > 0 ? { artwork } : {}),
    ...(provider && externalId ? { ids: { [provider]: externalId } } : {}),
  };
}

/** Pick the best match for a query from a provider's (already ranked) results. */
export function pickBestMatch(
  results: readonly MetadataResult[],
  query: MetadataQuery,
): MetadataResult | null {
  if (results.length === 0) return null;
  const wantTitle = query.title.trim().toLowerCase();
  // Prefer an exact title match with the requested year, then exact title,
  // then the provider's own top result.
  const exactTitleAndYear = results.find(
    (r) =>
      r.title.trim().toLowerCase() === wantTitle && query.year != null && r.year === query.year,
  );
  if (exactTitleAndYear) return exactTitleAndYear;
  const exactTitle = results.find((r) => r.title.trim().toLowerCase() === wantTitle);
  if (exactTitle) return exactTitle;
  return results[0] ?? null;
}

export class MetadataService {
  constructor(private readonly provider: MetadataProvider | null) {}

  /** True when a usable provider is configured (a key is present). */
  get enabled(): boolean {
    return this.provider !== null;
  }

  /** The active provider's name, or null when none is configured. */
  get providerName(): string | null {
    return this.provider?.name ?? null;
  }

  /** Search the provider; returns [] when no provider is configured. */
  async search(query: MetadataQuery): Promise<MetadataResult[]> {
    if (!this.provider) return [];
    return this.provider.search(query);
  }

  /** Fetch details for a ref; returns null when no provider is configured. */
  async details(ref: string): Promise<MetadataResult | null> {
    if (!this.provider) return null;
    return this.provider.details(ref);
  }

  /**
   * Resolve the single best match for a library item. Best-effort: provider
   * errors (network, HTTP) degrade to `null` rather than propagating, so a flaky
   * lookup never breaks browsing (§13.2). The caller falls back to the
   * filename-derived title when this returns null.
   */
  async resolve(query: MetadataQuery): Promise<MetadataResult | null> {
    if (!this.provider) return null;
    try {
      const results = await this.provider.search(query);
      return pickBestMatch(results, query);
    } catch {
      return null;
    }
  }
}

/** Options forwarded to a provider (injectable `fetch` for tests). */
export interface MetadataProviderDeps {
  fetch?: typeof globalThis.fetch;
  /** Sleep used for rate-limit backoff; injectable so tests don't really wait. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Build the configured provider, or `null` when metadata is disabled. Returns
 * null (not an error) when the provider is set but its key is missing, so a
 * half-configured metadata block degrades gracefully instead of crashing.
 */
export function createMetadataProvider(
  config: MetadataConfig | undefined,
  deps: MetadataProviderDeps = {},
): MetadataProvider | null {
  if (!config?.provider) return null;
  if (config.provider === 'tmdb') {
    if (!config.tmdbApiKey) return null;
    return new TmdbProvider({
      apiKey: config.tmdbApiKey,
      ...(config.language ? { language: config.language } : {}),
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
    });
  }
  return null;
}
