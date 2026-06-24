/**
 * Metadata pipeline integration (#44, FR-B1/B2). Where the per-unit suites cover
 * each piece in isolation, this wires the *real* classes together — TmdbProvider
 * (with an injected fetch, no live network) → MetadataService → CacheStore →
 * normalized MediaItem — and asserts the end-to-end behaviour the acceptance
 * criteria call out:
 *   - TMDB movie + TV responses normalize correctly (mapping).
 *   - A second resolve is served from cache with no second fetch (cache hit).
 *   - An expired entry refetches (cache miss/TTL).
 *   - With no provider key the whole pipeline degrades to filename titles with
 *     no errors, exercised through the real library API.
 *
 * Fully offline: every TMDB call goes through the injected fetch, asserted at the
 * end to have hit only api.themoviedb.org (CI never reaches the network).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { LibraryItem } from '@openhearth/shared';
import { buildApp } from './app.js';
import { ConfigService } from './core/ConfigService.js';
import { CacheStore } from './core/CacheStore.js';
import { LibraryService } from './core/LibraryService.js';
import { createMetadataProvider, MetadataService } from './core/MetadataService.js';
import { primeLibraryMetadata } from './core/enrichLibrary.js';

// Canned TMDB responses keyed by endpoint.
const MOVIE = {
  id: 603,
  title: 'The Matrix',
  release_date: '1999-03-31',
  overview: 'A hacker learns the truth.',
  poster_path: '/m.jpg',
  backdrop_path: '/b.jpg',
};
const TV = {
  id: 1396,
  name: 'Breaking Bad',
  first_air_date: '2008-01-20',
  poster_path: '/bb.jpg',
};

function tmdbFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const body = url.pathname.endsWith('/search/movie')
      ? { results: [MOVIE] }
      : url.pathname.endsWith('/search/tv')
        ? { results: [TV] }
        : { results: [] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

let store: CacheStore;
afterEach(() => store?.close());

describe('metadata pipeline — real provider → service → cache → model (#44)', () => {
  it('normalizes a TMDB movie end-to-end', async () => {
    const fetchImpl = tmdbFetch();
    store = new CacheStore(':memory:');
    const provider = createMetadataProvider(
      { provider: 'tmdb', tmdbApiKey: 'k' },
      { fetch: fetchImpl as unknown as typeof globalThis.fetch, sleep: async () => {} },
    );
    const svc = new MetadataService(provider, { cache: store });

    const media = await svc.resolveMedia({ title: 'The Matrix', year: 1999, kind: 'movie' });
    expect(media).toMatchObject({
      id: 'tmdb:movie:603',
      title: 'The Matrix',
      kind: 'movie',
      year: 1999,
      ids: { tmdb: '603' },
      artwork: { poster_url: 'https://image.tmdb.org/t/p/w500/m.jpg' },
    });
  });

  it('normalizes a TMDB tv result to the series kind', async () => {
    const fetchImpl = tmdbFetch();
    store = new CacheStore(':memory:');
    const provider = createMetadataProvider(
      { provider: 'tmdb', tmdbApiKey: 'k' },
      { fetch: fetchImpl as unknown as typeof globalThis.fetch, sleep: async () => {} },
    );
    const svc = new MetadataService(provider, { cache: store });
    const media = await svc.resolveMedia({ title: 'Breaking Bad', kind: 'tv' });
    expect(media).toMatchObject({ id: 'tmdb:tv:1396', kind: 'series', ids: { tmdb: '1396' } });
  });

  it('serves a second resolve from cache (no second fetch), and refetches after expiry', async () => {
    const fetchImpl = tmdbFetch();
    store = new CacheStore(':memory:');
    let clock = 1000;
    const provider = createMetadataProvider(
      { provider: 'tmdb', tmdbApiKey: 'k' },
      { fetch: fetchImpl as unknown as typeof globalThis.fetch, sleep: async () => {} },
    );
    const svc = new MetadataService(provider, { cache: store, now: () => clock });
    const q = { title: 'The Matrix', year: 1999, kind: 'movie' as const };

    await svc.resolveMedia(q);
    const callsAfterFirst = fetchImpl.mock.calls.length;
    await svc.resolveMedia(q);
    expect(fetchImpl.mock.calls.length).toBe(callsAfterFirst); // cache hit, no new fetch

    clock += 8 * 24 * 60 * 60 * 1000; // past the 7-day positive TTL
    await svc.resolveMedia(q);
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(callsAfterFirst); // refetched

    // Every request went to TMDB's API host only — no other network.
    for (const [input] of fetchImpl.mock.calls) {
      expect(new URL(String(input)).host).toBe('api.themoviedb.org');
    }
  });

  it('primes the cache so the library list then serves a poster (no second fetch)', async () => {
    const fetchImpl = tmdbFetch();
    store = new CacheStore(':memory:');
    store.upsertLibraryItems([
      {
        id: 'm1',
        source_id: 'movies',
        kind: 'movie',
        path: '/m/x.mkv',
        title: 'The Matrix',
        year: 1999,
        mtime: 1,
        indexed_at: 1,
      },
    ]);
    const provider = createMetadataProvider(
      { provider: 'tmdb', tmdbApiKey: 'k' },
      { fetch: fetchImpl as unknown as typeof globalThis.fetch, sleep: async () => {} },
    );
    const svc = new MetadataService(provider, { cache: store });
    const library = new LibraryService({ store, getSources: () => [] });

    await primeLibraryMetadata(library.list({}), { metadataService: svc });
    const fetchesAfterPrime = fetchImpl.mock.calls.length;
    expect(fetchesAfterPrime).toBeGreaterThan(0);

    // The list overlay reads the cache only — it must not trigger more fetches.
    expect(svc.cachedMedia({ title: 'The Matrix', year: 1999, kind: 'movie' })).not.toBeNull();
    expect(fetchImpl.mock.calls.length).toBe(fetchesAfterPrime);
  });
});

describe('no-provider degradation through the library API (#44, §13.2)', () => {
  let app: FastifyInstance;
  let cfg: ConfigService;
  let dir: string;

  afterEach(async () => {
    await app?.close();
    await cfg?.stop();
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('serves filename-derived titles with no artwork and no errors', async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-meta-degrade-'));
    cfg = new ConfigService({ configDir: dir });
    await cfg.load();
    store = new CacheStore(':memory:');
    const items: LibraryItem[] = [
      {
        id: 'm1',
        source_id: 'movies',
        kind: 'movie',
        path: '/m/Heat (1995).mkv',
        title: 'Heat',
        year: 1995,
        mtime: 1,
        indexed_at: 1,
      },
    ];
    store.upsertLibraryItems(items);

    // No metadata config → no provider → enabled is false.
    const provider = createMetadataProvider(cfg.config.metadata); // undefined config.metadata
    expect(provider).toBeNull();
    const metadataService = new MetadataService(provider, { cache: store });
    expect(metadataService.enabled).toBe(false);

    const libraryService = new LibraryService({ store, getSources: () => [] });
    app = buildApp({ configService: cfg, logLevel: 'silent', libraryService, metadataService });
    await app.ready();

    const list = (await app.inject({ url: '/api/v1/library' })).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].title).toBe('Heat'); // filename-derived title preserved
    expect(list.items[0].artwork_url).toBeUndefined(); // no external art

    // The by-id artwork route degrades to 404, not an error.
    expect((await app.inject({ url: '/api/v1/library/m1/artwork' })).statusCode).toBe(404);
    // resolveMedia is null; the prime is a no-op.
    await expect(metadataService.resolveMedia({ title: 'Heat' })).resolves.toBeNull();
    expect(await primeLibraryMetadata(items, { metadataService })).toBe(0);
  });
});
