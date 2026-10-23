/**
 * LibraryService — scan host-mapped folders into the disposable SQLite index
 * (FR-C1, FR-C6; plan §8 Phase 3, §9.2).
 *
 * For each configured `library.sources[]`, walks the folder, recognizes media
 * files by extension, derives Movie/TV structure from naming, and upserts the
 * result into {@link CacheStore}. Re-scans are incremental: a file whose mtime
 * is unchanged is skipped, and items whose files vanished are pruned. The index
 * is pure cache — deleting the DB and re-scanning reproduces it exactly.
 *
 * No metadata-provider or ffprobe work happens here; those enrich the rows in
 * later phases (#34/#41). Probe-derived columns stay null until then.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  PLAYBACK_FINISHED_THRESHOLD,
  type ContinueWatchingEntry,
  type LibraryItem,
  type LibrarySource,
} from '@openhearth/shared';
import { parseMediaPath, type SourceKind } from './libraryNaming.js';
import type { CacheStore } from './CacheStore.js';

/** Recognized media file extensions (lower-case, no dot). */
export const MEDIA_EXTENSIONS = new Set([
  // video
  'mkv',
  'mp4',
  'm4v',
  'mov',
  'avi',
  'webm',
  'ts',
  'm2ts',
  'mpg',
  'mpeg',
  'wmv',
  'flv',
  '3gp',
  'ogv',
  // audio
  'mp3',
  'flac',
  'm4a',
  'aac',
  'ogg',
  'oga',
  'opus',
  'wav',
  'wma',
]);

export interface SourceScanResult {
  source_id: string;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  errors: string[];
}

export interface ScanSummary {
  sources: SourceScanResult[];
  totalIndexed: number;
}

export interface LibraryServiceOptions {
  store: CacheStore;
  /** Reads the current sources (from ConfigService) at scan time. */
  getSources: () => readonly LibrarySource[];
  /** Injectable clock (epoch seconds) for deterministic tests. */
  now?: () => number;
}

export class LibraryService {
  private readonly store: CacheStore;
  private readonly getSources: () => readonly LibrarySource[];
  private readonly now: () => number;

  constructor(opts: LibraryServiceOptions) {
    this.store = opts.store;
    this.getSources = opts.getSources;
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /** Scan every configured source and reconcile the index. */
  scan(): ScanSummary {
    const results = this.getSources().map((source) => this.scanSource(source));
    return { sources: results, totalIndexed: this.store.countLibraryItems() };
  }

  /** List items by querying the store (used by the API layer). */
  list(query: Parameters<CacheStore['listLibraryItems']>[0] = {}): LibraryItem[] {
    return this.store.listLibraryItems(query);
  }

  /** Count items matching a filter (for pagination totals). */
  count(query: Parameters<CacheStore['countLibraryItems']>[0] = {}): number {
    return this.store.countLibraryItems(query);
  }

  /** Title substring search over the index (#43, FR-B3). */
  search(query: string, limit?: number): LibraryItem[] {
    return this.store.searchLibraryItems(query, limit);
  }

  /** Fetch a single item by id, or undefined. */
  get(id: string): LibraryItem | undefined {
    return this.store.getLibraryItem(id);
  }

  /** Saved resume position for an item (FR-C5), or undefined. */
  getResume(id: string): { position_sec: number; updated_at: number } | undefined {
    return this.store.getResumePosition(id);
  }

  /** Save a resume position; positions at/near the start are cleared instead. */
  setResume(id: string, positionSec: number): void {
    if (positionSec < 1) {
      this.store.clearResumePosition(id);
      return;
    }
    this.store.setResumePosition(id, positionSec, this.now());
  }

  /** Forget an item's resume position (finished / restart from 0). */
  clearResume(id: string): void {
    this.store.clearResumePosition(id);
  }

  /** Record that an item played to the end (#155) — drives "Next Up". */
  markWatched(id: string): void {
    this.store.markWatched(id, this.now());
  }

  /**
   * "Continue Watching" (#155): in-progress items, most-recently-watched first.
   * An item that's effectively finished (watched past
   * {@link PLAYBACK_FINISHED_THRESHOLD} of a known duration) is dropped — the
   * resume row lingers until the player marks it watched / it fires `ended`, so a
   * 99%-watched movie shouldn't cling to the row. We scan all resume rows (they're
   * naturally bounded — cleared on finish) and take the first `limit` that survive
   * the filter, so a run of finished items can't leave the row short.
   */
  listContinueWatching(limit: number): ContinueWatchingEntry[] {
    const out: ContinueWatchingEntry[] = [];
    for (const r of this.store.listResumePositions()) {
      const dur = r.item.duration_sec ?? null;
      const progress = dur && dur > 0 ? Math.min(1, r.position_sec / dur) : null;
      if (progress != null && progress >= PLAYBACK_FINISHED_THRESHOLD) continue;
      out.push({ item: r.item, position_sec: r.position_sec, updated_at: r.updated_at, progress });
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * "Next Up" (#155): the next unwatched episode for each series the user has
   * made progress in, most-recent series first. See {@link computeNextUp}.
   */
  listNextUp(limit: number): LibraryItem[] {
    const episodes = this.store.listLibraryItems({ kind: 'episode' });
    const watched = this.store.listWatched();
    const inProgress = new Set(this.store.listResumePositions().map((r) => r.item.id));
    return computeNextUp(episodes, watched, inProgress).slice(0, limit);
  }

  private scanSource(source: LibrarySource): SourceScanResult {
    const result: SourceScanResult = {
      source_id: source.id,
      added: 0,
      updated: 0,
      unchanged: 0,
      removed: 0,
      errors: [],
    };

    const known = this.store.getLibraryMtimes(source.id);
    const seen = new Set<string>();
    const toUpsert: LibraryItem[] = [];
    const indexedAt = this.now();

    let files: Array<{ abs: string; rel: string; mtime: number }>;
    try {
      files = this.walk(source.path);
    } catch (err) {
      const resolved = path.resolve(source.path);
      // A relative `path` resolves against the server's CWD (/app), not the media
      // mount — the #1 misconfiguration. Spell that out so it fails loudly: a bad
      // root otherwise just leaves stale items in the index and 403s at play time.
      const hint = path.isAbsolute(source.path)
        ? ''
        : ` — "${source.path}" is relative and resolved to "${resolved}"; use an` +
          ` absolute container path under your media mount (e.g. /media/${source.path}).`;
      result.errors.push(
        `library source root not found: source "${source.id}" (${source.path}): ` +
          `${(err as Error).message}${hint}`,
      );
      return result;
    }

    for (const file of files) {
      const id = itemId(source.id, file.rel);
      seen.add(id);
      const prevMtime = known.get(id);
      if (prevMtime === file.mtime) {
        result.unchanged += 1;
        continue;
      }
      const parsed = parseMediaPath(file.rel, source.kind as SourceKind);
      toUpsert.push({
        id,
        source_id: source.id,
        kind: parsed.kind,
        path: file.abs,
        title: parsed.title,
        year: parsed.year ?? null,
        season: parsed.season ?? null,
        episode: parsed.episode ?? null,
        episode_title: parsed.episode_title ?? null,
        duration_sec: null,
        container: path.extname(file.abs).slice(1).toLowerCase() || null,
        video_codec: null,
        audio_codec: null,
        mtime: file.mtime,
        indexed_at: indexedAt,
      });
      if (prevMtime === undefined) result.added += 1;
      else result.updated += 1;
    }

    if (toUpsert.length) this.store.upsertLibraryItems(toUpsert);

    // Prune items whose files are gone from this source.
    const removed = [...known.keys()].filter((id) => !seen.has(id));
    if (removed.length) {
      this.store.deleteLibraryItems(removed);
      result.removed = removed.length;
    }

    return result;
  }

  /** Recursively collect media files under `root` (absolute paths). */
  private walk(root: string): Array<{ abs: string; rel: string; mtime: number }> {
    const out: Array<{ abs: string; rel: string; mtime: number }> = [];
    const rootResolved = path.resolve(root);
    // A missing/inaccessible *root* is a real per-source error (surfaced by the
    // caller); only deeper dangling symlinks are tolerated below. Probe it up
    // front so the loop's per-dir catch can't swallow it.
    fs.accessSync(rootResolved);
    const stack: string[] = [rootResolved];
    // Track resolved real paths so a symlink cycle (or a dir reachable two ways)
    // is visited at most once — guards against infinite recursion.
    const visited = new Set<string>();

    while (stack.length) {
      const dir = stack.pop()!;
      let real: string;
      try {
        real = fs.realpathSync(dir);
      } catch {
        continue; // dangling/inaccessible
      }
      if (visited.has(real)) continue;
      visited.add(real);

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue; // skip hidden / sidecar dotfiles
        const abs = path.join(dir, entry.name);
        // Symlinks report neither isDirectory nor isFile — resolve the target so
        // symlinked media trees (common in NAS / *arr setups) are indexed.
        let isDir = entry.isDirectory();
        let isFile = entry.isFile();
        if (entry.isSymbolicLink()) {
          try {
            const st = fs.statSync(abs);
            isDir = st.isDirectory();
            isFile = st.isFile();
          } catch {
            continue; // dangling symlink
          }
        }
        if (isDir) {
          stack.push(abs);
        } else if (isFile) {
          const ext = path.extname(entry.name).slice(1).toLowerCase();
          if (!MEDIA_EXTENSIONS.has(ext)) continue;
          const stat = fs.statSync(abs);
          out.push({
            abs,
            rel: path.relative(rootResolved, abs),
            mtime: Math.floor(stat.mtimeMs / 1000),
          });
        }
      }
    }
    return out;
  }
}

/** Stable id for an item: a hash of source id + source-relative path. */
export function itemId(sourceId: string, relPath: string): string {
  return createHash('sha1').update(`${sourceId}\0${relPath}`).digest('hex');
}

/** Series identity for grouping episodes: source + show title (the show key). */
function seriesKey(ep: LibraryItem): string {
  return `${ep.source_id}\0${ep.title}`;
}

/** Order episodes by season then episode (missing season → 1, missing ep → 0). */
function compareEpisodes(a: LibraryItem, b: LibraryItem): number {
  const sa = a.season ?? 1;
  const sb = b.season ?? 1;
  if (sa !== sb) return sa - sb;
  return (a.episode ?? 0) - (b.episode ?? 0);
}

/**
 * Compute "Next Up" (#155): for each series where the user has finished at least
 * one episode, the episode immediately after the highest watched one — unless
 * that next episode is already in progress (Continue Watching covers it) or the
 * series is finished. Series are ordered by their most-recent watch, newest
 * first. Pure and deterministic for unit testing.
 */
export function computeNextUp(
  episodes: readonly LibraryItem[],
  watchedAt: ReadonlyMap<string, number>,
  inProgress: ReadonlySet<string>,
): LibraryItem[] {
  const groups = new Map<string, LibraryItem[]>();
  for (const ep of episodes) {
    const key = seriesKey(ep);
    const list = groups.get(key);
    if (list) list.push(ep);
    else groups.set(key, [ep]);
  }

  const results: Array<{ ep: LibraryItem; recency: number }> = [];
  for (const eps of groups.values()) {
    const sorted = [...eps].sort(compareEpisodes);
    let lastWatched = -1;
    let recency = 0;
    for (let i = 0; i < sorted.length; i++) {
      const ts = watchedAt.get(sorted[i]!.id);
      if (ts !== undefined) {
        lastWatched = i;
        recency = Math.max(recency, ts);
      }
    }
    if (lastWatched === -1) continue; // series not started
    const candidate = sorted[lastWatched + 1];
    if (!candidate) continue; // finished the series
    if (inProgress.has(candidate.id) || watchedAt.has(candidate.id)) continue;
    results.push({ ep: candidate, recency });
  }

  results.sort((a, b) => b.recency - a.recency);
  return results.map((r) => r.ep);
}
