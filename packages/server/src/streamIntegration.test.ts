/**
 * Real streaming integration (#38). Unlike libraryStream.test.ts (which injects
 * a fake streamer), this exercises the *actual* ffprobe decision and ffmpeg
 * pipeline against generated fixtures — one browser-direct-playable (mp4/h264)
 * and one that must transcode (mkv). It's gated on ffmpeg/ffprobe being present:
 * skipped on dev machines without them, run in CI (which installs ffmpeg).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { LibraryItem } from '@openhearth/shared';
import { buildApp } from './app.js';
import { ConfigService } from './core/ConfigService.js';
import { CacheStore } from './core/CacheStore.js';
import { LibraryService } from './core/LibraryService.js';
import { TranscodeService } from './core/TranscodeService.js';

function hasFfmpeg(): boolean {
  const probe = spawnSync('ffprobe', ['-version']);
  const mpeg = spawnSync('ffmpeg', ['-version']);
  return probe.status === 0 && mpeg.status === 0;
}

const ffmpegAvailable = hasFfmpeg();

let dir: string;
let cfg: ConfigService;
let store: CacheStore;
let app: FastifyInstance;
let directFile: string;
let transcodeFile: string;

function item(over: Partial<LibraryItem>): LibraryItem {
  return {
    id: 'x',
    source_id: 'media',
    kind: 'movie',
    path: '/none',
    title: 'X',
    mtime: 1,
    indexed_at: 1,
    ...over,
  };
}

function gen(args: string[]): void {
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg fixture gen failed: ${r.stderr?.toString()}`);
}

describe.skipIf(!ffmpegAvailable)('stream endpoint — real ffprobe/ffmpeg (#38)', () => {
  beforeAll(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-stream-int-'));
    directFile = path.join(dir, 'direct.mp4');
    transcodeFile = path.join(dir, 'needs-transcode.mkv');

    // Browser-direct-playable: H.264 + AAC in MP4.
    gen([
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=160x120:rate=12:d=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      '-movflags',
      '+faststart',
      directFile,
    ]);
    // Must transcode: an MKV container (browsers can't direct-play it).
    gen([
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=160x120:rate=12:d=2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      transcodeFile,
    ]);

    fs.writeFileSync(
      path.join(dir, 'openhearth.yaml'),
      `library:\n  sources:\n    - id: media\n      path: ${dir}\n`,
    );
    cfg = new ConfigService({ configDir: dir });
    await cfg.load();
    store = new CacheStore(':memory:');
    store.upsertLibraryItems([
      item({ id: 'direct', path: directFile, container: 'mp4' }),
      item({ id: 'trans', path: transcodeFile, container: 'mkv' }),
    ]);
    const libraryService = new LibraryService({ store, getSources: () => [] });
    app = buildApp({
      configService: cfg,
      logLevel: 'silent',
      libraryService,
      streamer: new TranscodeService(),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await cfg?.stop();
    store?.close();
    if (dir) await fsp.rm(dir, { recursive: true, force: true });
  });

  it('direct-plays an H.264/AAC MP4 (ffprobe decision) with range support (FR-C3)', async () => {
    const res = await app.inject({ url: '/api/v1/library/direct/stream' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(Number(res.headers['content-length'])).toBeGreaterThan(0);

    const ranged = await app.inject({
      url: '/api/v1/library/direct/stream',
      headers: { range: 'bytes=0-9' },
    });
    expect(ranged.statusCode).toBe(206);
    expect(ranged.headers['content-range']).toMatch(/^bytes 0-9\//);
    expect(ranged.rawPayload.length).toBe(10);
  });

  it('transcodes an MKV to fragmented MP4 (FR-C4)', async () => {
    const res = await app.inject({ url: '/api/v1/library/trans/stream' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');
    // Output is an MP4 stream — the ISO-BMFF 'ftyp' box appears near the start.
    expect(res.rawPayload.subarray(0, 64).includes(Buffer.from('ftyp'))).toBe(true);
  });
});

describe('stream integration availability', () => {
  it(ffmpegAvailable ? 'ran against real ffmpeg' : 'skipped (ffmpeg not installed)', () => {
    expect(typeof ffmpegAvailable).toBe('boolean');
  });
});
