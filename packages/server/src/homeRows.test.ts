import { describe, it, expect, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ContinueWatchingEntry, LibraryItem, NextUpResponse } from '@openhearth/shared';
import { buildApp } from './app.js';
import { ConfigService } from './core/ConfigService.js';
import { CacheStore } from './core/CacheStore.js';
import { LibraryService, computeNextUp } from './core/LibraryService.js';

function ep(over: Partial<LibraryItem>): LibraryItem {
  return {
    id: 'e',
    source_id: 'tv',
    kind: 'episode',
    path: '/media/tv/x.mkv',
    title: 'Show',
    season: 1,
    episode: 1,
    mtime: 1,
    indexed_at: 1,
    ...over,
  };
}

function movie(over: Partial<LibraryItem>): LibraryItem {
  return {
    id: 'm',
    source_id: 'movies',
    kind: 'movie',
    path: '/media/movies/x.mkv',
    title: 'Movie',
    mtime: 1,
    indexed_at: 1,
    ...over,
  };
}

describe('computeNextUp (#155)', () => {
  const eps = [
    ep({ id: 'e1', episode: 1 }),
    ep({ id: 'e2', episode: 2 }),
    ep({ id: 'e3', episode: 3 }),
  ];

  it('returns the episode after the highest watched one', () => {
    const next = computeNextUp(eps, new Map([['e1', 100]]), new Set());
    expect(next.map((e) => e.id)).toEqual(['e2']);
  });

  it('handles a gap: next after the highest watched, not the first unwatched', () => {
    const four = [...eps, ep({ id: 'e4', episode: 4 })];
    // Watched E1 and E3 (skipped E2) → next is E4, not E2.
    const next = computeNextUp(
      four,
      new Map([
        ['e1', 100],
        ['e3', 200],
      ]),
      new Set(),
    );
    expect(next.map((e) => e.id)).toEqual(['e4']);
  });

  it('is empty for a series not started', () => {
    expect(computeNextUp(eps, new Map(), new Set())).toEqual([]);
  });

  it('is empty when the series is finished', () => {
    const next = computeNextUp(
      eps,
      new Map([
        ['e1', 1],
        ['e2', 2],
        ['e3', 3],
      ]),
      new Set(),
    );
    expect(next).toEqual([]);
  });

  it('skips the series when the next episode is already in progress', () => {
    // Continue Watching covers an in-progress episode, so Next Up must not dupe it.
    const next = computeNextUp(eps, new Map([['e1', 100]]), new Set(['e2']));
    expect(next).toEqual([]);
  });

  it('orders series by most-recent watch, newest first', () => {
    const mixed = [
      ep({ id: 'a1', title: 'Alpha', source_id: 'tv', episode: 1 }),
      ep({ id: 'a2', title: 'Alpha', source_id: 'tv', episode: 2 }),
      ep({ id: 'b1', title: 'Bravo', source_id: 'tv', episode: 1 }),
      ep({ id: 'b2', title: 'Bravo', source_id: 'tv', episode: 2 }),
    ];
    const next = computeNextUp(
      mixed,
      new Map([
        ['a1', 100],
        ['b1', 200],
      ]),
      new Set(),
    );
    expect(next.map((e) => e.id)).toEqual(['b2', 'a2']); // Bravo watched more recently
  });

  it('keys series by source + title so same-named shows stay separate', () => {
    const two = [
      ep({ id: 'x1', title: 'Show', source_id: 'tvA', episode: 1 }),
      ep({ id: 'x2', title: 'Show', source_id: 'tvA', episode: 2 }),
      ep({ id: 'y1', title: 'Show', source_id: 'tvB', episode: 1 }),
    ];
    // Only tvA/Show is started; tvB/Show must stay separate (no next from it).
    const next = computeNextUp(two, new Map([['x1', 100]]), new Set());
    expect(next.map((e) => e.id)).toEqual(['x2']);
  });
});

describe('LibraryService continue/next-up (#155)', () => {
  function svc(seed: (s: CacheStore) => void): LibraryService {
    const store = new CacheStore(':memory:');
    seed(store);
    return new LibraryService({ store, getSources: () => [], now: () => 9999 });
  }

  it('lists in-progress items and drops effectively-finished ones', () => {
    const s = svc((store) => {
      store.upsertLibraryItems([
        movie({ id: 'm1', duration_sec: 100 }),
        movie({ id: 'm2', duration_sec: 100 }),
        movie({ id: 'm3' }), // no duration
      ]);
      store.setResumePosition('m1', 50, 1000); // 50% → keep
      store.setResumePosition('m2', 99, 2000); // 99% → finished, drop
      store.setResumePosition('m3', 30, 3000); // unknown duration → keep, progress null
    });
    const cw = s.listContinueWatching(20);
    expect(cw.map((e) => e.item.id)).toEqual(['m3', 'm1']); // newest first, m2 dropped
    expect(cw.find((e) => e.item.id === 'm1')?.progress).toBeCloseTo(0.5);
    expect(cw.find((e) => e.item.id === 'm3')?.progress).toBeNull();
  });

  it('computes Next Up from watched episodes via the store', () => {
    const s = svc((store) => {
      store.upsertLibraryItems([ep({ id: 'e1', episode: 1 }), ep({ id: 'e2', episode: 2 })]);
      store.markWatched('e1', 500);
    });
    expect(s.listNextUp(20).map((e) => e.id)).toEqual(['e2']);
  });

  it('markWatched records via the injected clock', () => {
    const store = new CacheStore(':memory:');
    store.upsertLibraryItem(ep({ id: 'e1' }));
    const s = new LibraryService({ store, getSources: () => [], now: () => 4242 });
    s.markWatched('e1');
    expect(store.listWatched().get('e1')).toBe(4242);
  });
});

let dir: string;
let cfg: ConfigService;
let store: CacheStore;
let app: FastifyInstance;

async function makeApp(seed: (s: CacheStore) => void, withLibrary = true): Promise<void> {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-home-'));
  cfg = new ConfigService({ configDir: dir });
  await cfg.load();
  store = new CacheStore(':memory:');
  seed(store);
  const libraryService = new LibraryService({ store, getSources: () => [] });
  app = buildApp({
    configService: cfg,
    logLevel: 'silent',
    ...(withLibrary ? { libraryService } : {}),
  });
  await app.ready();
}

afterEach(async () => {
  await app?.close();
  await cfg?.stop();
  store?.close();
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe('home rows API (#155)', () => {
  it('GET /home/continue returns in-progress entries with progress', async () => {
    await makeApp((s) => {
      s.upsertLibraryItem(movie({ id: 'm1', duration_sec: 200 }));
      s.setResumePosition('m1', 100, 1000);
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/home/continue' });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: ContinueWatchingEntry[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.item.id).toBe('m1');
    expect(items[0]!.progress).toBeCloseTo(0.5);
  });

  it('GET /home/next-up returns the next episode after a watched one', async () => {
    await makeApp((s) => {
      s.upsertLibraryItems([ep({ id: 'e1', episode: 1 }), ep({ id: 'e2', episode: 2 })]);
      s.markWatched('e1', 500);
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/home/next-up' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as NextUpResponse).items.map((i) => i.id)).toEqual(['e2']);
  });

  it('POST /library/:id/watched marks an item so Next Up advances', async () => {
    await makeApp((s) => {
      s.upsertLibraryItems([ep({ id: 'e1', episode: 1 }), ep({ id: 'e2', episode: 2 })]);
    });
    // Nothing watched yet → no Next Up.
    expect((await app.inject({ url: '/api/v1/home/next-up' })).json().items).toEqual([]);

    const post = await app.inject({ method: 'POST', url: '/api/v1/library/e1/watched' });
    expect(post.statusCode).toBe(200);

    const after = await app.inject({ url: '/api/v1/home/next-up' });
    expect((after.json() as NextUpResponse).items.map((i) => i.id)).toEqual(['e2']);
  });

  it('POST watched on an unknown id is a no-op 200', async () => {
    await makeApp(() => undefined);
    const res = await app.inject({ method: 'POST', url: '/api/v1/library/nope/watched' });
    expect(res.statusCode).toBe(200);
  });

  it('degrades to empty rows when the library is unavailable', async () => {
    await makeApp(() => undefined, false);
    expect((await app.inject({ url: '/api/v1/home/continue' })).json()).toEqual({ items: [] });
    expect((await app.inject({ url: '/api/v1/home/next-up' })).json()).toEqual({ items: [] });
  });
});
