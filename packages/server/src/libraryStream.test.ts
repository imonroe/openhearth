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
import type { MediaStreamer, TranscodeStream } from './core/TranscodeService.js';
import type { ProbeResult } from './core/transcodeDecision.js';

let dir: string;
let cfg: ConfigService;
let store: CacheStore;
let app: FastifyInstance;
let directFile: string;
let transFile: string;
let lastSeek: number | undefined;

const TRANSCODE_BYTES = Buffer.from('FAKE-FMP4-OUTPUT');

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

/** A fake streamer: directFile → direct-play; everything else → transcode. */
const streamer: MediaStreamer = {
  probe: (p: string): Promise<ProbeResult> =>
    Promise.resolve(
      p === directFile
        ? { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac' }
        : { container: 'mkv', videoCodec: 'hevc' },
    ),
  openTranscode: (_p: string, opts): TranscodeStream => {
    lastSeek = opts?.seekSec;
    return { stream: Readable.from([TRANSCODE_BYTES]), kill: () => {} };
  },
};

async function makeApp(withStreamer = true): Promise<void> {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-stream-'));
  directFile = path.join(dir, 'movie.mp4');
  transFile = path.join(dir, 'movie.mkv');
  fs.writeFileSync(directFile, Buffer.from('0123456789'.repeat(100))); // 1000 bytes
  fs.writeFileSync(transFile, Buffer.from('rawdata'));

  cfg = new ConfigService({ configDir: dir });
  await cfg.load();
  store = new CacheStore(':memory:');
  store.upsertLibraryItems([
    item({ id: 'direct', path: directFile, container: 'mp4' }),
    item({ id: 'trans', path: transFile, kind: 'episode', container: 'mkv' }),
    item({ id: 'missing', path: path.join(dir, 'gone.mp4') }),
  ]);
  const libraryService = new LibraryService({ store, getSources: () => [] });
  app = buildApp({
    configService: cfg,
    logLevel: 'silent',
    libraryService,
    ...(withStreamer ? { streamer } : {}),
  });
  await app.ready();
  lastSeek = undefined;
}

beforeEach(() => makeApp());

afterEach(async () => {
  await app?.close();
  await cfg?.stop();
  store?.close();
  await fsp.rm(dir, { recursive: true, force: true });
});

describe('GET /api/v1/library/:id/stream — direct play', () => {
  it('serves the whole file with range support headers (FR-C3)', async () => {
    const res = await app.inject({ url: '/api/v1/library/direct/stream' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-length']).toBe('1000');
    expect(res.rawPayload.length).toBe(1000);
  });

  it('honors a byte range with 206 + Content-Range', async () => {
    const res = await app.inject({
      url: '/api/v1/library/direct/stream',
      headers: { range: 'bytes=0-9' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 0-9/1000');
    expect(res.headers['content-length']).toBe('10');
    expect(res.rawPayload.toString()).toBe('0123456789');
  });

  it('returns 416 for an unsatisfiable range', async () => {
    const res = await app.inject({
      url: '/api/v1/library/direct/stream',
      headers: { range: 'bytes=5000-6000' },
    });
    expect(res.statusCode).toBe(416);
    expect(res.headers['content-range']).toBe('bytes */1000');
  });
});

describe('GET /api/v1/library/:id/stream — transcode', () => {
  it('streams transcoded fMP4 for an unsupported codec/container (FR-C4)', async () => {
    const res = await app.inject({ url: '/api/v1/library/trans/stream' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.rawPayload.equals(TRANSCODE_BYTES)).toBe(true);
  });

  it('passes a seek offset (?t=) into the transcode (resume/seek)', async () => {
    await app.inject({ url: '/api/v1/library/trans/stream?t=90' });
    expect(lastSeek).toBe(90);
  });
});

describe('GET /api/v1/library/:id/stream — errors', () => {
  it('404s an unknown id', async () => {
    expect((await app.inject({ url: '/api/v1/library/nope/stream' })).statusCode).toBe(404);
  });

  it('404s when the file is missing on disk', async () => {
    expect((await app.inject({ url: '/api/v1/library/missing/stream' })).statusCode).toBe(404);
  });

  it('503s when no transcoder is wired', async () => {
    await app.close();
    await makeApp(/* withStreamer */ false);
    expect((await app.inject({ url: '/api/v1/library/direct/stream' })).statusCode).toBe(503);
  });
});
