/**
 * MetadataService contract tests (#39): provider delegation, best-match
 * selection, the no-provider degradation path, and the config-driven factory.
 * Uses a mocked provider — no TMDB specifics, no network.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  MetadataService,
  pickBestMatch,
  createMetadataProvider,
  mediaItemFromMetadata,
  metadataCacheKey,
  metadataQueryForLibraryItem,
  type MetadataProvider,
  type MetadataResult,
} from './MetadataService.js';
import { mediaItemSchema } from '@openhearth/shared';
import { CacheStore } from './CacheStore.js';
import { TmdbProvider } from './TmdbProvider.js';

function result(over: Partial<MetadataResult>): MetadataResult {
  return { ref: 'x:movie:1', kind: 'movie', title: 'X', artwork: {}, ...over };
}

function fakeProvider(over: Partial<MetadataProvider> = {}): MetadataProvider {
  return {
    name: 'fake',
    search: vi.fn(async () => []),
    details: vi.fn(async () => null),
    ...over,
  };
}

describe('MetadataService — with a provider', () => {
  it('delegates search and details to the provider', async () => {
    const hit = result({ ref: 'fake:movie:42', title: 'Heat', year: 1995 });
    const provider = fakeProvider({
      search: vi.fn(async () => [hit]),
      details: vi.fn(async () => hit),
    });
    const svc = new MetadataService(provider);

    expect(svc.enabled).toBe(true);
    expect(svc.providerName).toBe('fake');
    await expect(svc.search({ title: 'Heat' })).resolves.toEqual([hit]);
    await expect(svc.details('fake:movie:42')).resolves.toEqual(hit);
    expect(provider.search).toHaveBeenCalledWith({ title: 'Heat' });
  });

  it('resolve() picks the best match', async () => {
    const provider = fakeProvider({
      search: vi.fn(async () => [
        result({ ref: 'fake:movie:1', title: 'Heat', year: 1986 }),
        result({ ref: 'fake:movie:2', title: 'Heat', year: 1995 }),
      ]),
    });
    const svc = new MetadataService(provider);
    const best = await svc.resolve({ title: 'Heat', year: 1995 });
    expect(best?.ref).toBe('fake:movie:2');
  });

  it('resolve() degrades to null when the provider throws (best-effort)', async () => {
    const provider = fakeProvider({
      search: vi.fn(async () => {
        throw new Error('network down');
      }),
    });
    const svc = new MetadataService(provider);
    await expect(svc.resolve({ title: 'Heat' })).resolves.toBeNull();
  });
});

describe('MetadataService — no provider (graceful degradation, NFR-9/§13.2)', () => {
  const svc = new MetadataService(null);

  it('reports disabled and returns empty/null without error', async () => {
    expect(svc.enabled).toBe(false);
    expect(svc.providerName).toBeNull();
    await expect(svc.search({ title: 'Heat' })).resolves.toEqual([]);
    await expect(svc.details('x')).resolves.toBeNull();
    await expect(svc.resolve({ title: 'Heat', year: 1995 })).resolves.toBeNull();
  });
});

describe('pickBestMatch', () => {
  it('prefers exact title + year, then exact title, then first', () => {
    const list = [
      result({ ref: 'a', title: 'The Thing', year: 2011 }),
      result({ ref: 'b', title: 'The Thing', year: 1982 }),
      result({ ref: 'c', title: 'Thing', year: 1982 }),
    ];
    expect(pickBestMatch(list, { title: 'The Thing', year: 1982 })?.ref).toBe('b');
    expect(pickBestMatch(list, { title: 'the thing' })?.ref).toBe('a'); // exact title, first
    expect(pickBestMatch(list, { title: 'nope' })?.ref).toBe('a'); // fallback: first
    expect(pickBestMatch([], { title: 'x' })).toBeNull();
  });
});

describe('MetadataService.resolveMedia — caching (#41)', () => {
  const matrix = result({ ref: 'tmdb:movie:603', title: 'The Matrix', year: 1999, artwork: {} });

  function setup(search: MetadataProvider['search'] = vi.fn(async () => [matrix])) {
    const provider = fakeProvider({ search });
    const store = new CacheStore(':memory:');
    let clock = 1_000;
    const svc = new MetadataService(provider, { cache: store, now: () => clock });
    return { svc, store, search, provider, advance: (ms: number) => (clock += ms) };
  }

  it('resolves once and serves the second load from cache (no repeat fetch)', async () => {
    const { svc, search } = setup();
    const first = await svc.resolveMedia({ title: 'The Matrix', year: 1999, kind: 'movie' });
    expect(first).toMatchObject({ id: 'tmdb:movie:603', title: 'The Matrix', kind: 'movie' });

    const second = await svc.resolveMedia({ title: 'The Matrix', year: 1999, kind: 'movie' });
    expect(second).toEqual(first);
    expect(search).toHaveBeenCalledTimes(1); // served from cache
  });

  it('caches a miss (negative) so an unmatched title is not refetched', async () => {
    const { svc, search } = setup(vi.fn(async () => []));
    expect(await svc.resolveMedia({ title: 'Nope', kind: 'movie' })).toBeNull();
    expect(await svc.resolveMedia({ title: 'Nope', kind: 'movie' })).toBeNull();
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('refetches after the entry expires', async () => {
    const { svc, search, advance } = setup();
    await svc.resolveMedia({ title: 'The Matrix', year: 1999, kind: 'movie' });
    advance(8 * 24 * 60 * 60 * 1000); // past the 7-day positive TTL
    await svc.resolveMedia({ title: 'The Matrix', year: 1999, kind: 'movie' });
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('does not cache a transient provider error (retries next time)', async () => {
    const search = vi
      .fn<MetadataProvider['search']>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce([matrix]);
    const { svc } = setup(search);
    expect(await svc.resolveMedia({ title: 'The Matrix', kind: 'movie' })).toBeNull();
    // Second call retries (error was not cached) and now succeeds.
    expect(await svc.resolveMedia({ title: 'The Matrix', kind: 'movie' })).toMatchObject({
      id: 'tmdb:movie:603',
    });
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('a cold cache (disposable) refetches everything', async () => {
    const { svc, store, search } = setup();
    await svc.resolveMedia({ title: 'The Matrix', kind: 'movie' });
    expect(search).toHaveBeenCalledTimes(1);
    // Simulate clearing /cache: a brand-new store has no rows.
    const fresh = new CacheStore(':memory:');
    const search2 = vi.fn(async () => [matrix]);
    const svc2 = new MetadataService(fakeProvider({ search: search2 }), { cache: fresh });
    await svc2.resolveMedia({ title: 'The Matrix', kind: 'movie' });
    expect(search2).toHaveBeenCalledTimes(1); // cold cache → refetch
    store.close();
    fresh.close();
  });

  it('with no provider returns null and never touches the cache (degradation)', async () => {
    const store = new CacheStore(':memory:');
    const svc = new MetadataService(null, { cache: store });
    const query = { title: 'The Matrix', year: 1999, kind: 'movie' as const };
    expect(await svc.resolveMedia(query)).toBeNull();
    expect(store.getMetadata(metadataCacheKey(query))).toBeUndefined();
    store.close();
  });
});

describe('metadataQueryForLibraryItem (#42)', () => {
  it('maps library kind to the provider hint', () => {
    const base = {
      id: 'i',
      source_id: 's',
      path: '/p',
      title: 'T',
      mtime: 1,
      indexed_at: 1,
    } as const;
    expect(metadataQueryForLibraryItem({ ...base, kind: 'movie', year: 1999 })).toEqual({
      title: 'T',
      year: 1999,
      kind: 'movie',
    });
    expect(metadataQueryForLibraryItem({ ...base, kind: 'episode' })).toEqual({
      title: 'T',
      kind: 'tv',
    });
    // `other` searches both (no kind hint).
    expect(metadataQueryForLibraryItem({ ...base, kind: 'other' })).toEqual({ title: 'T' });
  });
});

describe('MetadataService.cachedMedia (#42, cache-only)', () => {
  it('returns a fresh cached item and null on cold/expired', () => {
    const store = new CacheStore(':memory:');
    let clock = 1000;
    const svc = new MetadataService(null, { cache: store, now: () => clock });
    const query = { title: 'Heat', year: 1995, kind: 'movie' as const };
    expect(svc.cachedMedia(query)).toBeNull(); // cold

    store.setMetadata(metadataCacheKey(query), {
      item: { id: 'tmdb:movie:949', title: 'Heat', kind: 'movie' },
      fetched_at: clock,
      expires_at: clock + 100,
    });
    expect(svc.cachedMedia(query)?.id).toBe('tmdb:movie:949');
    clock += 200; // now expired
    expect(svc.cachedMedia(query)).toBeNull();
    store.close();
  });

  it('never fetches (no provider needed)', () => {
    const store = new CacheStore(':memory:');
    const svc = new MetadataService(null, { cache: store });
    expect(svc.cachedMedia({ title: 'X' })).toBeNull();
    store.close();
  });
});

describe('metadataCacheKey', () => {
  it('is stable for the same query (trim + lowercase) and distinct across fields', () => {
    expect(metadataCacheKey({ title: ' The Matrix ', year: 1999, kind: 'movie' })).toBe(
      metadataCacheKey({ title: 'the matrix', year: 1999, kind: 'movie' }),
    );
    expect(metadataCacheKey({ title: 'X', year: 1999 })).not.toBe(
      metadataCacheKey({ title: 'X', year: 2000 }),
    );
  });

  it('does not collide when a title contains the delimiter', () => {
    // A naive `${kind}|${title}|${year}` would let these two collide.
    expect(metadataCacheKey({ title: 'a|movie|1', kind: 'movie' })).not.toBe(
      metadataCacheKey({ title: 'a', kind: 'movie' }),
    );
  });
});

describe('mediaItemFromMetadata (#40 normalized model)', () => {
  it('maps a movie result, deriving ids from the ref and schema-valid output', () => {
    const item = mediaItemFromMetadata(
      result({
        ref: 'tmdb:movie:603',
        kind: 'movie',
        title: 'The Matrix',
        year: 1999,
        overview: 'A hacker learns the truth.',
        artwork: { poster_url: 'https://img/p.jpg', backdrop_url: 'https://img/b.jpg' },
      }),
    );
    expect(item).toEqual({
      id: 'tmdb:movie:603',
      title: 'The Matrix',
      kind: 'movie',
      year: 1999,
      overview: 'A hacker learns the truth.',
      artwork: { poster_url: 'https://img/p.jpg', backdrop_url: 'https://img/b.jpg' },
      ids: { tmdb: '603' },
    });
    expect(mediaItemSchema.safeParse(item).success).toBe(true);
  });

  it('maps tv → the provider-agnostic series kind and omits absent fields', () => {
    const item = mediaItemFromMetadata(
      result({ ref: 'tmdb:tv:1396', kind: 'tv', title: 'Breaking Bad', artwork: {} }),
    );
    expect(item.kind).toBe('series');
    expect(item.year).toBeUndefined();
    expect(item.artwork).toBeUndefined();
    expect(item.ids).toEqual({ tmdb: '1396' });
  });

  it('omits ids for a ref that is not exactly <provider>:<kind>:<id>', () => {
    expect(mediaItemFromMetadata(result({ ref: 'malformed', artwork: {} })).ids).toBeUndefined();
    expect(
      mediaItemFromMetadata(result({ ref: 'tmdb:movie:603:extra', artwork: {} })).ids,
    ).toBeUndefined();
  });

  it('never populates the reserved availability slot', () => {
    const item = mediaItemFromMetadata(
      result({ ref: 'tmdb:movie:603', artwork: { poster_url: 'https://img/p.jpg' } }),
    );
    expect(item.availability).toBeUndefined();
  });
});

describe('createMetadataProvider', () => {
  it('returns null when metadata is unconfigured', () => {
    expect(createMetadataProvider(undefined)).toBeNull();
    expect(createMetadataProvider({})).toBeNull();
  });

  it('returns null when the provider is tmdb but the key is missing (graceful)', () => {
    expect(createMetadataProvider({ provider: 'tmdb' })).toBeNull();
  });

  it('builds a TmdbProvider when a key is present', () => {
    const p = createMetadataProvider({ provider: 'tmdb', tmdbApiKey: 'k' });
    expect(p).toBeInstanceOf(TmdbProvider);
    expect(p?.name).toBe('tmdb');
  });
});
