import { describe, it, expect } from 'vitest';
import type { LibraryItem } from '@openhearth/shared';
import { CacheStore } from './CacheStore.js';

function item(over: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: 'a1',
    source_id: 'movies',
    kind: 'movie',
    path: '/media/movies/Heat (1995).mkv',
    title: 'Heat',
    year: 1995,
    mtime: 1000,
    indexed_at: 2000,
    ...over,
  };
}

describe('CacheStore', () => {
  it('tolerates a cold DB and round-trips an item with nulls', () => {
    const store = new CacheStore(':memory:');
    expect(store.listLibraryItems()).toEqual([]); // cold DB is empty, not an error

    store.upsertLibraryItem(item());
    const got = store.getLibraryItem('a1');
    expect(got).toMatchObject({ id: 'a1', title: 'Heat', year: 1995, kind: 'movie' });
    // Optional probe fields were stored as NULL and come back absent.
    expect(got?.duration_sec).toBeUndefined();
    expect(got?.season).toBeUndefined();
    store.close();
  });

  it('INSERT OR REPLACE updates an existing id', () => {
    const store = new CacheStore(':memory:');
    store.upsertLibraryItem(item());
    store.upsertLibraryItem(item({ title: 'Heat (Director Cut)', mtime: 1500 }));
    expect(store.countLibraryItems()).toBe(1);
    expect(store.getLibraryItem('a1')?.title).toBe('Heat (Director Cut)');
    store.close();
  });

  it('filters by source_id and kind and paginates', () => {
    const store = new CacheStore(':memory:');
    store.upsertLibraryItems([
      item({ id: 'm1', source_id: 'movies', kind: 'movie', title: 'Alpha' }),
      item({ id: 'm2', source_id: 'movies', kind: 'movie', title: 'Bravo' }),
      item({
        id: 'e1',
        source_id: 'tv',
        kind: 'episode',
        title: 'Show',
        season: 1,
        episode: 1,
        year: null,
      }),
    ]);
    expect(store.listLibraryItems({ source_id: 'movies' })).toHaveLength(2);
    expect(store.listLibraryItems({ kind: 'episode' })).toHaveLength(1);
    expect(store.countLibraryItems({ source_id: 'movies' })).toBe(2);

    const page = store.listLibraryItems({ source_id: 'movies', limit: 1, offset: 1 });
    expect(page).toHaveLength(1);
    expect(page[0]!.title).toBe('Bravo'); // ordered by title
    store.close();
  });

  it('reports mtimes and deletes by id', () => {
    const store = new CacheStore(':memory:');
    store.upsertLibraryItems([item({ id: 'a', mtime: 11 }), item({ id: 'b', mtime: 22 })]);
    const mtimes = store.getLibraryMtimes('movies');
    expect(mtimes.get('a')).toBe(11);
    expect(mtimes.get('b')).toBe(22);

    store.deleteLibraryItems(['a']);
    expect(store.getLibraryItem('a')).toBeUndefined();
    expect(store.countLibraryItems()).toBe(1);
    store.close();
  });
});

describe('CacheStore — search (#43)', () => {
  it('matches title substrings case-insensitively, ordered, with a limit', () => {
    const store = new CacheStore(':memory:');
    store.upsertLibraryItems([
      item({ id: 'a', title: 'The Matrix' }),
      item({ id: 'b', title: 'Matrix Reloaded' }),
      item({ id: 'c', title: 'Heat' }),
    ]);
    const hits = store.searchLibraryItems('matrix');
    expect(hits.map((h) => h.title)).toEqual(['Matrix Reloaded', 'The Matrix']); // title ASC
    expect(store.searchLibraryItems('MATRIX')).toHaveLength(2); // case-insensitive
    expect(store.searchLibraryItems('matrix', 1)).toHaveLength(1); // limit
    store.close();
  });

  it('returns [] for an empty/whitespace query', () => {
    const store = new CacheStore(':memory:');
    store.upsertLibraryItems([item({ id: 'a', title: 'X' })]);
    expect(store.searchLibraryItems('')).toEqual([]);
    expect(store.searchLibraryItems('   ')).toEqual([]);
    store.close();
  });

  it('treats LIKE metacharacters as literals (escaped)', () => {
    const store = new CacheStore(':memory:');
    store.upsertLibraryItems([
      item({ id: 'a', title: '100% Wolf' }),
      item({ id: 'b', title: '50 First Dates' }),
    ]);
    // A bare `%` would match everything; escaped, it matches only the literal.
    expect(store.searchLibraryItems('100%').map((h) => h.id)).toEqual(['a']);
    store.close();
  });
});

describe('CacheStore — metadata cache (#41)', () => {
  it('cold read is undefined; round-trips a positive entry', () => {
    const store = new CacheStore(':memory:');
    expect(store.getMetadata('movie|heat|1995')).toBeUndefined();

    const mediaItem = { id: 'tmdb:movie:949', title: 'Heat', kind: 'movie' as const, year: 1995 };
    store.setMetadata('movie|heat|1995', { item: mediaItem, fetched_at: 100, expires_at: 200 });
    expect(store.getMetadata('movie|heat|1995')).toEqual({
      item: mediaItem,
      fetched_at: 100,
      expires_at: 200,
    });
    store.close();
  });

  it('round-trips a negative (cached-miss) entry as item: null', () => {
    const store = new CacheStore(':memory:');
    store.setMetadata('movie|nope|', { item: null, fetched_at: 1, expires_at: 2 });
    expect(store.getMetadata('movie|nope|')).toEqual({ item: null, fetched_at: 1, expires_at: 2 });
    store.close();
  });

  it('treats a corrupt stored payload as absent (stale schema or non-JSON → refetch)', () => {
    const store = new CacheStore(':memory:');
    const raw = store as unknown as {
      db: { prepare(sql: string): { run(...args: unknown[]): void } };
    };
    const corrupt = (key: string, payload: string): void => {
      store.setMetadata(key, { item: null, fetched_at: 1, expires_at: 2 });
      raw.db.prepare('UPDATE metadata_cache SET payload = ? WHERE key = ?').run(payload, key);
    };
    // Valid JSON, wrong shape (older schema):
    corrupt('schema', '{"bad":true}');
    expect(store.getMetadata('schema')).toBeUndefined();
    // Not even JSON — getMetadata must not throw:
    corrupt('garbage', 'not json{');
    expect(store.getMetadata('garbage')).toBeUndefined();
    store.close();
  });

  it('clears an entry', () => {
    const store = new CacheStore(':memory:');
    store.setMetadata('k', { item: null, fetched_at: 1, expires_at: 2 });
    store.clearMetadata('k');
    expect(store.getMetadata('k')).toBeUndefined();
    store.close();
  });
});
