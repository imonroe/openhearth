/**
 * Background metadata-prime tests (#42): resolves unique titles once, caches
 * results (so the next read is a cache hit), pre-downloads artwork, and is a
 * no-op with no provider configured.
 */
import { describe, it, expect, vi } from 'vitest';
import type { LibraryItem } from '@openhearth/shared';
import { MetadataService, type MetadataProvider, type MetadataResult } from './MetadataService.js';
import { CacheStore } from './CacheStore.js';
import { primeLibraryMetadata } from './enrichLibrary.js';

function item(over: Partial<LibraryItem>): LibraryItem {
  return {
    id: 'i',
    source_id: 'movies',
    kind: 'movie',
    path: '/m/x.mkv',
    title: 'X',
    mtime: 1,
    indexed_at: 1,
    ...over,
  };
}

const matrix: MetadataResult = {
  ref: 'tmdb:movie:603',
  kind: 'movie',
  title: 'The Matrix',
  year: 1999,
  artwork: { poster_url: 'https://image.tmdb.org/t/p/w500/m.jpg' },
};

function provider(search: MetadataProvider['search']): MetadataProvider {
  return { name: 'tmdb', search, details: vi.fn(async () => null) };
}

describe('primeLibraryMetadata', () => {
  it('resolves each unique title once and populates the cache', async () => {
    const search = vi.fn(async () => [matrix]);
    const store = new CacheStore(':memory:');
    const svc = new MetadataService(provider(search), { cache: store });

    // Two episodes of one show + a movie → the show resolves once.
    const items = [
      item({ id: 'm', kind: 'movie', title: 'The Matrix', year: 1999 }),
      item({ id: 'e1', kind: 'episode', title: 'Show', season: 1, episode: 1 }),
      item({ id: 'e2', kind: 'episode', title: 'Show', season: 1, episode: 2 }),
    ];
    const resolved = await primeLibraryMetadata(items, { metadataService: svc });
    expect(resolved).toBe(2); // movie + show (episodes share a query)
    expect(search).toHaveBeenCalledTimes(2);

    // Cached now: a subsequent resolve serves from cache (no new search).
    expect(svc.cachedMedia({ title: 'The Matrix', year: 1999, kind: 'movie' })?.id).toBe(
      'tmdb:movie:603',
    );
    store.close();
  });

  it('pre-downloads artwork via the cache when a poster resolves', async () => {
    const store = new CacheStore(':memory:');
    const svc = new MetadataService(provider(vi.fn(async () => [matrix])), { cache: store });
    const ensure = vi.fn(async () => ({ path: '/x', contentType: 'image/jpeg' }));
    const artworkCache = { ensure } as unknown as Parameters<
      typeof primeLibraryMetadata
    >[1]['artworkCache'];

    await primeLibraryMetadata([item({ title: 'The Matrix', year: 1999 })], {
      metadataService: svc,
      artworkCache,
    });
    expect(ensure).toHaveBeenCalledWith('https://image.tmdb.org/t/p/w500/m.jpg');
    store.close();
  });

  it('is a no-op with no provider configured', async () => {
    const store = new CacheStore(':memory:');
    const svc = new MetadataService(null, { cache: store });
    const resolved = await primeLibraryMetadata([item({ title: 'X' })], { metadataService: svc });
    expect(resolved).toBe(0);
    store.close();
  });
});
