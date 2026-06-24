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
