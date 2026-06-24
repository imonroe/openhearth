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
import type { LibraryItem, LibrarySource } from '@openhearth/shared';
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

  /** Fetch a single item by id, or undefined. */
  get(id: string): LibraryItem | undefined {
    return this.store.getLibraryItem(id);
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
      result.errors.push(`source "${source.id}" (${source.path}): ${(err as Error).message}`);
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
