/**
 * CacheStore — the derived, disposable SQLite cache (plan §9.2).
 *
 * Holds the library index (and, in later phases, the metadata cache and resume
 * positions). It is **never** the source of truth: every row is rebuildable from
 * config + filesystem + provider, and any code path must tolerate a cold DB.
 * Deleting `cache/openhearth.db` and re-scanning reproduces the index.
 *
 * Synchronous by design (better-sqlite3): the scans and reads here are small and
 * local, and synchronous SQLite keeps the call sites simple and race-free.
 */
import Database from 'better-sqlite3';
import { libraryItemSchema, type LibraryItem } from '@openhearth/shared';

/** Current cache schema version — bump when the table shapes change. */
const SCHEMA_VERSION = 1;

export interface LibraryQuery {
  source_id?: string;
  kind?: LibraryItem['kind'];
  limit?: number;
  offset?: number;
}

/** Columns in `library_items`, in a fixed order for prepared statements. */
const COLUMNS = [
  'id',
  'source_id',
  'kind',
  'path',
  'title',
  'year',
  'season',
  'episode',
  'episode_title',
  'duration_sec',
  'container',
  'video_codec',
  'audio_codec',
  'mtime',
  'indexed_at',
] as const;

type Row = Record<(typeof COLUMNS)[number], unknown>;

export class CacheStore {
  private readonly db: Database.Database;

  /** Open (or create) the cache DB. Pass `:memory:` for tests. */
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  /** Create tables on a cold DB. Idempotent. */
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS library_items (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        title TEXT NOT NULL,
        year INTEGER,
        season INTEGER,
        episode INTEGER,
        episode_title TEXT,
        duration_sec INTEGER,
        container TEXT,
        video_codec TEXT,
        audio_codec TEXT,
        mtime INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_library_source ON library_items (source_id);
      CREATE INDEX IF NOT EXISTS idx_library_kind ON library_items (kind);

      CREATE TABLE IF NOT EXISTS resume_positions (
        item_id TEXT PRIMARY KEY,
        position_sec INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }

  /** Insert or replace one item. */
  upsertLibraryItem(item: LibraryItem): void {
    const placeholders = COLUMNS.map((c) => `@${c}`).join(', ');
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO library_items (${COLUMNS.join(', ')}) VALUES (${placeholders})`,
    );
    // better-sqlite3 rejects `undefined` — coerce every optional field to null.
    const params = Object.fromEntries(
      COLUMNS.map((c) => [c, (item as Record<string, unknown>)[c] ?? null]),
    );
    stmt.run(params);
  }

  /** Insert/replace many items in a single transaction. */
  upsertLibraryItems(items: readonly LibraryItem[]): void {
    const tx = this.db.transaction((rows: readonly LibraryItem[]) => {
      for (const row of rows) this.upsertLibraryItem(row);
    });
    tx(items);
  }

  getLibraryItem(id: string): LibraryItem | undefined {
    const row = this.db.prepare('SELECT * FROM library_items WHERE id = ?').get(id) as
      | Row
      | undefined;
    return row ? this.rowToItem(row) : undefined;
  }

  listLibraryItems(query: LibraryQuery = {}): LibraryItem[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (query.source_id !== undefined) {
      where.push('source_id = @source_id');
      params.source_id = query.source_id;
    }
    if (query.kind !== undefined) {
      where.push('kind = @kind');
      params.kind = query.kind;
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    // Stable ordering for paginated browse: title, then season/episode.
    let sql = `SELECT * FROM library_items ${whereClause} ORDER BY title ASC, season ASC, episode ASC`;
    if (query.limit !== undefined) {
      sql += ' LIMIT @limit OFFSET @offset';
      params.limit = query.limit;
      params.offset = query.offset ?? 0;
    }
    const rows = this.db.prepare(sql).all(params) as Row[];
    return rows.map((r) => this.rowToItem(r));
  }

  countLibraryItems(query: Pick<LibraryQuery, 'source_id' | 'kind'> = {}): number {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (query.source_id !== undefined) {
      where.push('source_id = @source_id');
      params.source_id = query.source_id;
    }
    if (query.kind !== undefined) {
      where.push('kind = @kind');
      params.kind = query.kind;
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM library_items ${whereClause}`)
      .get(params) as { n: number };
    return row.n;
  }

  /** Map of id -> mtime for a source, to drive incremental re-scan. */
  getLibraryMtimes(source_id: string): Map<string, number> {
    const rows = this.db
      .prepare('SELECT id, mtime FROM library_items WHERE source_id = ?')
      .all(source_id) as Array<{ id: string; mtime: number }>;
    return new Map(rows.map((r) => [r.id, r.mtime]));
  }

  /** Remove items by id (prune files that disappeared from disk). */
  deleteLibraryItems(ids: readonly string[]): void {
    if (ids.length === 0) return;
    const stmt = this.db.prepare('DELETE FROM library_items WHERE id = ?');
    const tx = this.db.transaction((toDelete: readonly string[]) => {
      for (const id of toDelete) stmt.run(id);
    });
    tx(ids);
  }

  /** Save (or clear) the resume position for an item (FR-C5). */
  setResumePosition(itemId: string, positionSec: number, updatedAt: number): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO resume_positions (item_id, position_sec, updated_at)
         VALUES (@item_id, @position_sec, @updated_at)`,
      )
      .run({
        item_id: itemId,
        position_sec: Math.max(0, Math.round(positionSec)),
        updated_at: updatedAt,
      });
  }

  /** Get the saved resume position (seconds) for an item, or undefined. */
  getResumePosition(itemId: string): { position_sec: number; updated_at: number } | undefined {
    return this.db
      .prepare('SELECT position_sec, updated_at FROM resume_positions WHERE item_id = ?')
      .get(itemId) as { position_sec: number; updated_at: number } | undefined;
  }

  /** Forget an item's resume position (e.g. on finish/stop-at-start). */
  clearResumePosition(itemId: string): void {
    this.db.prepare('DELETE FROM resume_positions WHERE item_id = ?').run(itemId);
  }

  close(): void {
    this.db.close();
  }

  /** Validate a DB row back into a LibraryItem (drops SQL nulls to undefined). */
  private rowToItem(row: Row): LibraryItem {
    const obj: Record<string, unknown> = {};
    for (const c of COLUMNS) {
      const v = row[c];
      if (v !== null) obj[c] = v;
    }
    return libraryItemSchema.parse(obj);
  }
}
