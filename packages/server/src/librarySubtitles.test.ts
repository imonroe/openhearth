import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type { LibraryItem } from '@openhearth/shared';
import { buildApp } from './app.js';
import { ConfigService } from './core/ConfigService.js';
import { CacheStore } from './core/CacheStore.js';
import { LibraryService } from './core/LibraryService.js';
import type { MediaStreamer } from './core/TranscodeService.js';

let dir: string;
let cfg: ConfigService;
let store: CacheStore;
let app: FastifyInstance;
let mediaPath: string;

const EMBEDDED_VTT = Buffer.from('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nembedded\n');

// Fake streamer exposing one embedded subtitle stream (index 2).
const streamer: MediaStreamer = {
  probe: () => Promise.resolve({ container: 'mkv', videoCodec: 'hevc' }),
  openTranscode: () => ({ stream: Readable.from([Buffer.from('x')]), kill: () => {} }),
  probeSubtitles: () => Promise.resolve([{ index: 2, lang: 'eng', title: 'English' }]),
  openSubtitleExtract: () => ({ stream: Readable.from([EMBEDDED_VTT]), kill: () => {} }),
};

function item(over: Partial<LibraryItem>): LibraryItem {
  return {
    id: 'x',
    source_id: 'movies',
    kind: 'movie',
    path: '/none',
    title: 'X',
    mtime: 1,
    indexed_at: 1,
    ...over,
  };
}

async function makeApp(withStreamer = true): Promise<void> {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-subs-'));
  mediaPath = path.join(dir, 'Heat (1995).mkv');
  fs.writeFileSync(mediaPath, 'video');
  fs.writeFileSync(
    path.join(dir, 'Heat (1995).en.srt'),
    '1\n00:00:01,000 --> 00:00:02,000\nHello\n',
  );
  fs.writeFileSync(
    path.join(dir, 'openhearth.yaml'),
    `library:\n  sources:\n    - id: movies\n      path: ${dir}\n`,
  );

  cfg = new ConfigService({ configDir: dir });
  await cfg.load();
  store = new CacheStore(':memory:');
  store.upsertLibraryItems([item({ id: 'm1', path: mediaPath })]);
  const libraryService = new LibraryService({ store, getSources: () => [] });
  app = buildApp({
    configService: cfg,
    logLevel: 'silent',
    libraryService,
    ...(withStreamer ? { streamer } : {}),
  });
  await app.ready();
}

beforeEach(() => makeApp());

afterEach(async () => {
  await app?.close();
  await cfg?.stop();
  store?.close();
  await fsp.rm(dir, { recursive: true, force: true });
});

describe('GET /api/v1/library/:id/subtitles', () => {
  it('lists sidecar then embedded tracks (FR-C7)', async () => {
    const tracks = (await app.inject({ url: '/api/v1/library/m1/subtitles' })).json();
    expect(tracks).toEqual([
      { id: '0', label: 'Subtitles (en)', lang: 'en', source: 'sidecar' },
      { id: '1', label: 'English', lang: 'eng', source: 'embedded' },
    ]);
  });

  it('404s an unknown item', async () => {
    expect((await app.inject({ url: '/api/v1/library/nope/subtitles' })).statusCode).toBe(404);
  });
});

describe('GET /api/v1/library/:id/subtitles/:track', () => {
  it('serves a sidecar SRT converted to WebVTT', async () => {
    const res = await app.inject({ url: '/api/v1/library/m1/subtitles/0' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/vtt');
    expect(res.body.startsWith('WEBVTT')).toBe(true);
    expect(res.body).toContain('00:00:01.000 --> 00:00:02.000'); // comma → dot
    expect(res.body).toContain('Hello');
  });

  it('serves an embedded track as WebVTT', async () => {
    const res = await app.inject({ url: '/api/v1/library/m1/subtitles/1' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/vtt');
    expect(res.body).toContain('embedded');
  });

  it('404s an unknown track id', async () => {
    expect((await app.inject({ url: '/api/v1/library/m1/subtitles/9' })).statusCode).toBe(404);
  });
});
