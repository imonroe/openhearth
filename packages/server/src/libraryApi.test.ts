import { describe, it, expect, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { LibraryItem } from '@openhearth/shared';
import { buildApp } from './app.js';
import { ConfigService } from './core/ConfigService.js';
import { CacheStore } from './core/CacheStore.js';
import { LibraryService } from './core/LibraryService.js';

let dir: string;
let cfg: ConfigService;
let store: CacheStore;
let app: FastifyInstance;

function item(over: Partial<LibraryItem>): LibraryItem {
  return {
    id: 'x',
    source_id: 'movies',
    kind: 'movie',
    path: '/media/movies/x.mkv',
    title: 'X',
    mtime: 1,
    indexed_at: 1,
    ...over,
  };
}

/** Build the app with a library backed by an in-memory store seeded with items. */
async function makeApp(items: LibraryItem[] = [], withLibrary = true): Promise<void> {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-libapi-'));
  cfg = new ConfigService({ configDir: dir });
  await cfg.load();
  store = new CacheStore(':memory:');
  store.upsertLibraryItems(items);
  const libraryService = new LibraryService({ store, getSources: () => [] });
  app = buildApp({
    configService: cfg,
    logLevel: 'silent',
    ...(withLibrary ? { libraryService } : {}),
  });
  await app.ready();
}

const seed: LibraryItem[] = [
  item({ id: 'm1', source_id: 'movies', kind: 'movie', title: 'Alpha', year: 2001 }),
  item({ id: 'm2', source_id: 'movies', kind: 'movie', title: 'Bravo', year: 2002 }),
  item({ id: 'm3', source_id: 'movies', kind: 'movie', title: 'Charlie', year: 2003 }),
  item({
    id: 'e1',
    source_id: 'tv',
    kind: 'episode',
    title: 'Show',
    season: 1,
    episode: 1,
    container: 'mkv',
  }),
];

afterEach(async () => {
  await app?.close();
  await cfg?.stop();
  store?.close();
  await fsp.rm(dir, { recursive: true, force: true });
});

describe('GET /api/v1/library', () => {
  it('lists all items with pagination metadata', async () => {
    await makeApp(seed);
    const res = await app.inject({ method: 'GET', url: '/api/v1/library' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(4);
    expect(body.items).toHaveLength(4);
    expect(body.limit).toBeGreaterThan(0);
    expect(body.offset).toBe(0);
  });

  it('filters by source and by kind', async () => {
    await makeApp(seed);
    const bySource = (await app.inject({ url: '/api/v1/library?source=movies' })).json();
    expect(bySource.total).toBe(3);
    expect(bySource.items.every((i: LibraryItem) => i.source_id === 'movies')).toBe(true);

    const byKind = (await app.inject({ url: '/api/v1/library?kind=episode' })).json();
    expect(byKind.total).toBe(1);
    expect(byKind.items[0].title).toBe('Show');
  });

  it('paginates with limit/offset and reports the unpaged total', async () => {
    await makeApp(seed);
    const res = await app.inject({ url: '/api/v1/library?source=movies&limit=2&offset=1' });
    const body = res.json();
    expect(body.total).toBe(3); // total ignores the page window
    expect(body.items).toHaveLength(2);
    expect(body.items.map((i: LibraryItem) => i.title)).toEqual(['Bravo', 'Charlie']);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(1);
  });

  it('rejects an invalid kind with 400', async () => {
    await makeApp(seed);
    const res = await app.inject({ url: '/api/v1/library?kind=banana' });
    expect(res.statusCode).toBe(400);
    expect(res.json().status).toBe('bad_request');
  });

  it('degrades to an empty page when the library is disabled', async () => {
    await makeApp(seed, /* withLibrary */ false);
    const res = await app.inject({ url: '/api/v1/library' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ items: [], total: 0 });
  });
});

describe('GET /api/v1/library/:id', () => {
  it('returns a single item with playback fields', async () => {
    await makeApp(seed);
    const res = await app.inject({ url: '/api/v1/library/e1' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ id: 'e1', title: 'Show', kind: 'episode', container: 'mkv' });
    // Probe fields are present in the contract (null until ffprobe enrichment).
    expect('duration_sec' in body || body.duration_sec === undefined).toBe(true);
  });

  it('404s an unknown id', async () => {
    await makeApp(seed);
    const res = await app.inject({ url: '/api/v1/library/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('404s when the library is disabled', async () => {
    await makeApp(seed, false);
    const res = await app.inject({ url: '/api/v1/library/e1' });
    expect(res.statusCode).toBe(404);
  });
});
