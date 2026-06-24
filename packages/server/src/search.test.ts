/**
 * Search API (#43, FR-B3). v1 returns local-library matches grouped into a
 * `library` section of normalized media items; artwork is overlaid (by-id) when
 * cached. Empty query → empty sections; disabled library → empty, never errors.
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

let dir: string;
let cfg: ConfigService;
let store: CacheStore;
let app: FastifyInstance;

function item(over: Partial<LibraryItem>): LibraryItem {
  return {
    id: 'x',
    source_id: 'movies',
    kind: 'movie',
    path: '/m/x.mkv',
    title: 'X',
    mtime: 1,
    indexed_at: 1,
    ...over,
  };
}

const seed: LibraryItem[] = [
  item({ id: 'a', title: 'The Matrix', year: 1999 }),
  item({ id: 'b', title: 'Matrix Reloaded', year: 2003 }),
  item({ id: 'c', title: 'Heat', year: 1995 }),
];

async function makeApp(opts: { withLibrary?: boolean; withArt?: boolean } = {}): Promise<void> {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-search-'));
  cfg = new ConfigService({ configDir: dir });
  await cfg.load();
  store = new CacheStore(':memory:');
  store.upsertLibraryItems(seed);
  const libraryService = new LibraryService({ store, getSources: () => [] });

  let metadataService: MetadataService | undefined;
  if (opts.withArt) {
    const provider: MetadataProvider = {
      name: 'tmdb',
      search: vi.fn(async () => []),
      details: vi.fn(async () => null),
    };
    metadataService = new MetadataService(provider, { cache: store });
    store.setMetadata(metadataCacheKey(metadataQueryForLibraryItem(seed[0]!)), {
      item: {
        id: 'tmdb:movie:603',
        title: 'The Matrix',
        kind: 'movie',
        artwork: { poster_url: 'https://image.tmdb.org/t/p/w500/m.jpg' },
      },
      fetched_at: 0,
      expires_at: Number.MAX_SAFE_INTEGER,
    });
  }

  app = buildApp({
    configService: cfg,
    logLevel: 'silent',
    ...(opts.withLibrary === false ? {} : { libraryService }),
    ...(metadataService ? { metadataService } : {}),
  });
  await app.ready();
}

afterEach(async () => {
  await app?.close();
  await cfg?.stop();
  store?.close();
  await fsp.rm(dir, { recursive: true, force: true });
});

describe('GET /api/v1/search', () => {
  it('returns a library section of normalized media items', async () => {
    await makeApp();
    const body = (await app.inject({ url: '/api/v1/search?q=matrix' })).json();
    expect(body.query).toBe('matrix');
    expect(body.total).toBe(2);
    expect(body.sections).toHaveLength(1);
    expect(body.sections[0]).toMatchObject({ source: 'library', label: 'Your Library' });
    expect(body.sections[0].items.map((m: { title: string }) => m.title)).toEqual([
      'Matrix Reloaded',
      'The Matrix',
    ]);
    // Items are the normalized model (id/title/kind), not raw library rows.
    expect(body.sections[0].items[0]).toMatchObject({ id: 'b', kind: 'movie' });
  });

  it('overlays a by-id artwork poster when cached', async () => {
    await makeApp({ withArt: true });
    const body = (await app.inject({ url: '/api/v1/search?q=the+matrix' })).json();
    const matrix = body.sections[0].items.find((m: { id: string }) => m.id === 'a');
    expect(matrix.artwork.poster_url).toBe('/api/v1/library/a/artwork');
  });

  it('returns one result per episode for a show (known stub limitation)', async () => {
    // Episodes carry the show title, so a show match returns one episode-kind
    // result per episode (no series grouping yet — a documented v1.x follow-up).
    await makeApp();
    store.upsertLibraryItems([
      item({
        id: 'e1',
        source_id: 'tv',
        kind: 'episode',
        title: 'The Wire',
        season: 1,
        episode: 1,
      }),
      item({
        id: 'e2',
        source_id: 'tv',
        kind: 'episode',
        title: 'The Wire',
        season: 1,
        episode: 2,
      }),
    ]);
    const body = (await app.inject({ url: '/api/v1/search?q=wire' })).json();
    const items = body.sections[0].items;
    expect(items).toHaveLength(2);
    expect(items.every((m: { title: string; kind: string }) => m.title === 'The Wire')).toBe(true);
    expect(items.map((m: { id: string }) => m.id).sort()).toEqual(['e1', 'e2']);
  });

  it('returns no sections for an empty query', async () => {
    await makeApp();
    const body = (await app.inject({ url: '/api/v1/search?q=' })).json();
    expect(body).toMatchObject({ query: '', sections: [], total: 0 });
  });

  it('returns no sections for a non-matching query (not an error)', async () => {
    await makeApp();
    const body = (await app.inject({ url: '/api/v1/search?q=zzzznope' })).json();
    expect(body.sections).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('degrades to empty when the library is disabled', async () => {
    await makeApp({ withLibrary: false });
    const res = await app.inject({ url: '/api/v1/search?q=matrix' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sections: [], total: 0 });
  });
});
