import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LibrarySource } from '@openhearth/shared';
import { CacheStore } from './CacheStore.js';
import { LibraryService } from './LibraryService.js';

let root: string;
let store: CacheStore;

function write(rel: string, contents = 'x'): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
  return abs;
}

function service(sources: LibrarySource[], now = 100): LibraryService {
  return new LibraryService({ store, getSources: () => sources, now: () => now });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'oh-lib-'));
  store = new CacheStore(':memory:');
});

afterEach(() => {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('LibraryService.scan', () => {
  it('indexes a mixed folder, detecting movies and episodes (FR-C1/FR-C6)', () => {
    write('movies/Heat (1995).mkv');
    write('movies/Blade.Runner.1982.1080p.mkv');
    write('tv/The Office/Season 02/The Office - S02E05 - Halloween.mkv');
    write('movies/readme.txt'); // ignored: not media
    write('movies/.hidden.mkv'); // ignored: hidden

    const summary = service([
      { id: 'movies', path: path.join(root, 'movies'), kind: 'movies' },
      { id: 'tv', path: path.join(root, 'tv'), kind: 'tv' },
    ]).scan();

    expect(summary.totalIndexed).toBe(3);
    const movies = store.listLibraryItems({ source_id: 'movies' });
    expect(movies.map((m) => m.title).sort()).toEqual(['Blade Runner', 'Heat']);
    expect(movies.every((m) => m.kind === 'movie')).toBe(true);

    const ep = store.listLibraryItems({ source_id: 'tv' })[0]!;
    expect(ep).toMatchObject({
      kind: 'episode',
      title: 'The Office',
      season: 2,
      episode: 5,
      episode_title: 'Halloween',
      container: 'mkv',
    });
  });

  it('re-scans incrementally: unchanged skipped, modified updated', () => {
    const f = write('movies/Heat (1995).mkv');
    const svc = service([{ id: 'movies', path: path.join(root, 'movies'), kind: 'movies' }], 100);
    const first = svc.scan();
    expect(first.sources[0]).toMatchObject({ added: 1, updated: 0, unchanged: 0 });

    // No change -> unchanged.
    const second = svc.scan();
    expect(second.sources[0]).toMatchObject({ added: 0, updated: 0, unchanged: 1 });

    // Bump mtime -> updated.
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(f, later, later);
    const third = svc.scan();
    expect(third.sources[0]).toMatchObject({ added: 0, updated: 1, unchanged: 0 });
  });

  it('prunes items whose files were removed', () => {
    write('movies/Heat (1995).mkv');
    const gone = write('movies/Old Movie (2000).mkv');
    const sources: LibrarySource[] = [{ id: 'movies', path: path.join(root, 'movies') }];
    service(sources).scan();
    expect(store.countLibraryItems()).toBe(2);

    fs.rmSync(gone);
    const summary = service(sources).scan();
    expect(summary.sources[0]!.removed).toBe(1);
    expect(store.countLibraryItems()).toBe(1);
    expect(store.listLibraryItems()[0]!.title).toBe('Heat');
  });

  it('follows a symlinked subdirectory (NAS / *arr layouts) without looping', () => {
    write('movies/real/Heat (1995).mkv');
    // A symlink pointing at a sibling real directory, plus a self-referential
    // loop that must not hang the scan.
    fs.symlinkSync(path.join(root, 'movies/real'), path.join(root, 'movies/linked'), 'dir');
    fs.symlinkSync(path.join(root, 'movies'), path.join(root, 'movies/loop'), 'dir');

    const summary = service([
      { id: 'movies', path: path.join(root, 'movies'), kind: 'movies' },
    ]).scan();

    // Heat is found via both real/ and linked/ (distinct relative paths -> two
    // items), and the loop symlink is visited once and does not hang.
    expect(summary.sources[0]!.errors).toEqual([]);
    expect(store.countLibraryItems()).toBeGreaterThanOrEqual(1);
    expect(store.listLibraryItems().some((i) => i.title === 'Heat')).toBe(true);
  });

  it('records a non-fatal error for a missing source path and keeps going', () => {
    write('movies/Heat (1995).mkv');
    const summary = service([
      { id: 'movies', path: path.join(root, 'movies'), kind: 'movies' },
      { id: 'ghost', path: path.join(root, 'does-not-exist'), kind: 'movies' },
    ]).scan();

    expect(store.countLibraryItems()).toBe(1); // the good source still indexed
    const ghost = summary.sources.find((s) => s.source_id === 'ghost')!;
    expect(ghost.errors.length).toBe(1);
    expect(ghost.added).toBe(0);
  });

  it('is disposable: deleting the DB and re-scanning reproduces the index', () => {
    write('movies/Heat (1995).mkv');
    write('tv/Show/Season 01/Show - S01E01.mkv');
    const sources: LibrarySource[] = [
      { id: 'movies', path: path.join(root, 'movies'), kind: 'movies' },
      { id: 'tv', path: path.join(root, 'tv'), kind: 'tv' },
    ];

    const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oh-db-'));
    const dbPath = path.join(dbDir, 'openhearth.db');
    try {
      const s1 = new CacheStore(dbPath);
      new LibraryService({ store: s1, getSources: () => sources, now: () => 100 }).scan();
      const before = s1.listLibraryItems().map((i) => ({ id: i.id, title: i.title, kind: i.kind }));
      s1.close();

      // Nuke the derived cache entirely.
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(`${dbPath}-wal`, { force: true });
      fs.rmSync(`${dbPath}-shm`, { force: true });

      const s2 = new CacheStore(dbPath);
      new LibraryService({ store: s2, getSources: () => sources, now: () => 100 }).scan();
      const after = s2.listLibraryItems().map((i) => ({ id: i.id, title: i.title, kind: i.kind }));
      s2.close();

      expect(after).toEqual(before);
      expect(after).toHaveLength(2);
    } finally {
      fs.rmSync(dbDir, { recursive: true, force: true });
    }
  });
});
