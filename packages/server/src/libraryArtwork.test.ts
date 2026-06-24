/**
 * Library artwork overlay + by-id artwork endpoint (#42, FR-C2).
 *
 * The list/detail responses overlay `artwork_url` from the metadata cache (cache
 * only — never a provider call on the request path), and GET /library/:id/artwork
 * serves the cached poster bytes. With no provider (disabled service) neither
 * appears, so the library still serves cleanly (§13.2).
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
import {
  MetadataService,
  metadataCacheKey,
  metadataQueryForLibraryItem,
  type MetadataProvider,
} from './core/MetadataService.js';
import type { ArtworkCache } from './core/ArtworkCache.js';

let dir: string;
let cfg: ConfigService;
let store: CacheStore;
let app: FastifyInstance;

function item(over: Partial<LibraryItem>): LibraryItem {
  return {
    id: 'm1',
    source_id: 'movies',
    kind: 'movie',
    path: '/media/movies/x.mkv',
    title: 'Alpha',
    year: 2001,
    mtime: 1,
    indexed_at: 1,
    ...over,
  };
}

const enabledProvider: MetadataProvider = {
  name: 'tmdb',
  search: vi.fn(async () => []),
  details: vi.fn(async () => null),
};

/** Build the app with metadata enabled and `seed`'s query pre-cached with a poster. */
async function makeApp(
  opts: { withArt?: boolean; artworkCache?: ArtworkCache } = {},
): Promise<void> {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-libart-'));
  cfg = new ConfigService({ configDir: dir });
  await cfg.load();
  store = new CacheStore(':memory:');
  const seedItem = item({});
  store.upsertLibraryItems([seedItem]);

  const metadataService = new MetadataService(enabledProvider, { cache: store });
  if (opts.withArt !== false) {
    store.setMetadata(metadataCacheKey(metadataQueryForLibraryItem(seedItem)), {
      item: {
        id: 'tmdb:movie:1',
        title: 'Alpha',
        kind: 'movie',
        artwork: { poster_url: 'https://image.tmdb.org/t/p/w500/alpha.jpg' },
      },
      fetched_at: 0,
      expires_at: Number.MAX_SAFE_INTEGER,
    });
  }
  const libraryService = new LibraryService({ store, getSources: () => [] });
  app = buildApp({
    configService: cfg,
    logLevel: 'silent',
    libraryService,
    metadataService,
    ...(opts.artworkCache ? { artworkCache: opts.artworkCache } : {}),
  });
  await app.ready();
}

afterEach(async () => {
  await app?.close();
  await cfg?.stop();
  store?.close();
  await fsp.rm(dir, { recursive: true, force: true });
});

describe('artwork overlay (#42)', () => {
  it('overlays a by-id artwork_url on the list and detail when cached', async () => {
    await makeApp();
    const list = (await app.inject({ url: '/api/v1/library' })).json();
    expect(list.items[0].artwork_url).toBe('/api/v1/library/m1/artwork');
    const detail = (await app.inject({ url: '/api/v1/library/m1' })).json();
    expect(detail.artwork_url).toBe('/api/v1/library/m1/artwork');
  });

  it('omits artwork_url when nothing is cached (cold cache → placeholder)', async () => {
    await makeApp({ withArt: false });
    const list = (await app.inject({ url: '/api/v1/library' })).json();
    expect(list.items[0].artwork_url).toBeUndefined();
  });

  it('serves the cached poster bytes from the by-id endpoint', async () => {
    const file = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-poster-')), 'p.jpg');
    await fsp.writeFile(file, Buffer.from([1, 2, 3, 4]));
    const ensure = vi.fn(async () => ({ path: file, contentType: 'image/jpeg' }));
    await makeApp({ artworkCache: { ensure } as unknown as ArtworkCache });

    const res = await app.inject({ url: '/api/v1/library/m1/artwork' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toContain('max-age');
    expect(res.rawPayload.length).toBe(4);
    expect(ensure).toHaveBeenCalledWith('https://image.tmdb.org/t/p/w500/alpha.jpg');
  });

  it('404s artwork for an unknown id and when nothing is cached', async () => {
    const ensure = vi.fn(async () => null);
    await makeApp({ withArt: false, artworkCache: { ensure } as unknown as ArtworkCache });
    expect((await app.inject({ url: '/api/v1/library/m1/artwork' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/v1/library/nope/artwork' })).statusCode).toBe(404);
    expect(ensure).not.toHaveBeenCalled();
  });
});
