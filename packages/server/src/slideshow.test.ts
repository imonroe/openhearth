import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { SlideshowManifest } from '@openhearth/shared';
import { buildApp } from './app.js';
import { ConfigService } from './core/ConfigService.js';

// A real 1×1 transparent PNG (valid signature) for upload tests.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const TINY_PNG = Buffer.from(TINY_PNG_BASE64, 'base64');

let configDir: string;
let photosDir: string;
let cfg: ConfigService;
let app: FastifyInstance;

async function makeApp(yaml?: string): Promise<void> {
  configDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-ss-cfg-'));
  if (yaml !== undefined) fs.writeFileSync(path.join(configDir, 'openhearth.yaml'), yaml);
  cfg = new ConfigService({ configDir });
  await cfg.load();
  app = buildApp({ configService: cfg, logLevel: 'silent' });
  await app.ready();
}

/** Write a source folder of images referenced from a slideshow config. */
async function makePhotosDir(files: Record<string, Buffer>): Promise<string> {
  photosDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-ss-photos-'));
  for (const [rel, buf] of Object.entries(files)) {
    const target = path.join(photosDir, rel);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, buf);
  }
  return photosDir;
}

async function manifest(): Promise<SlideshowManifest> {
  const res = await app.inject({ method: 'GET', url: '/api/v1/slideshow/manifest' });
  expect(res.statusCode).toBe(200);
  return res.json() as SlideshowManifest;
}

afterEach(async () => {
  await app?.close();
  await cfg?.stop();
  await fsp.rm(configDir, { recursive: true, force: true }).catch(() => undefined);
  if (photosDir) await fsp.rm(photosDir, { recursive: true, force: true }).catch(() => undefined);
  photosDir = '';
});

describe('slideshow manifest (#164)', () => {
  it('is empty with defaults when nothing is configured or uploaded', async () => {
    await makeApp('server:\n  port: 8080\n');
    const m = await manifest();
    expect(m.images).toEqual([]);
    expect(m.settings).toEqual({
      intervalSeconds: 8,
      transition: 'crossfade',
      order: 'sequential',
    });
  });

  it('reflects configured playback settings', async () => {
    await makeApp(
      [
        'ui:',
        '  slideshow:',
        '    intervalSeconds: 20',
        '    transition: wipe',
        '    order: shuffle',
        '',
      ].join('\n'),
    );
    const m = await manifest();
    expect(m.settings).toEqual({ intervalSeconds: 20, transition: 'wipe', order: 'shuffle' });
  });

  it('lists images from a configured folder source and skips non-images', async () => {
    const dir = await makePhotosDir({
      'a.png': TINY_PNG,
      'b.jpg': Buffer.from([0xff, 0xd8, 0xff, 0x00]),
      'notes.txt': Buffer.from('ignore me'),
    });
    await makeApp(
      [
        'ui:',
        '  slideshow:',
        '    sources:',
        `      - id: photos`,
        `        path: ${dir}`,
        '',
      ].join('\n'),
    );
    const m = await manifest();
    expect(m.images.length).toBe(2);
    expect(m.images.every((i) => i.uploaded === false)).toBe(true);
  });

  it('does not descend into subfolders unless recursive is set', async () => {
    const dir = await makePhotosDir({ 'top.png': TINY_PNG, 'sub/deep.png': TINY_PNG });
    await makeApp(
      [
        'ui:',
        '  slideshow:',
        '    sources:',
        '      - id: photos',
        `        path: ${dir}`,
        '',
      ].join('\n'),
    );
    expect((await manifest()).images.length).toBe(1);

    await app.close();
    await cfg.stop();
    await makeApp(
      [
        'ui:',
        '  slideshow:',
        '    sources:',
        '      - id: photos',
        `        path: ${dir}`,
        '        recursive: true',
        '',
      ].join('\n'),
    );
    expect((await manifest()).images.length).toBe(2);
  });
});

describe('slideshow image serve (#164)', () => {
  it('serves an image by id with nosniff + cache headers', async () => {
    const dir = await makePhotosDir({ 'a.png': TINY_PNG });
    await makeApp(
      [
        'ui:',
        '  slideshow:',
        '    sources:',
        '      - id: photos',
        `        path: ${dir}`,
        '',
      ].join('\n'),
    );
    const id = (await manifest()).images[0]!.id;
    const res = await app.inject({ method: 'GET', url: `/api/v1/slideshow/image/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toContain('max-age');
  });

  it('404s for an unknown id', async () => {
    await makeApp('server:\n  port: 8080\n');
    const res = await app.inject({ method: 'GET', url: '/api/v1/slideshow/image/deadbeef' });
    expect(res.statusCode).toBe(404);
  });
});

describe('slideshow photo upload/delete (#164)', () => {
  it('uploads a photo that appears in the manifest and serves', async () => {
    await makeApp('server:\n  port: 8080\n');
    const up = await app.inject({
      method: 'POST',
      url: '/api/v1/slideshow/photos',
      payload: { content_type: 'image/png', data_base64: TINY_PNG_BASE64 },
    });
    expect(up.statusCode).toBe(200);
    const m = up.json().manifest as SlideshowManifest;
    expect(m.images.length).toBe(1);
    expect(m.images[0]!.uploaded).toBe(true);
    // Stored under config/slideshow/uploads/.
    const uploads = path.join(configDir, 'slideshow', 'uploads');
    expect(fs.readdirSync(uploads).length).toBe(1);

    const serve = await app.inject({
      method: 'GET',
      url: `/api/v1/slideshow/image/${m.images[0]!.id}`,
    });
    expect(serve.statusCode).toBe(200);
  });

  it('accepts a GIF upload (raster only)', async () => {
    await makeApp('server:\n  port: 8080\n');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/slideshow/photos',
      payload: {
        content_type: 'image/gif',
        data_base64: Buffer.from('GIF89a', 'ascii').toString('base64'),
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects mismatched magic bytes (415), SVG (400), and empty (400)', async () => {
    await makeApp('server:\n  port: 8080\n');
    const mismatch = await app.inject({
      method: 'POST',
      url: '/api/v1/slideshow/photos',
      payload: { content_type: 'image/webp', data_base64: TINY_PNG_BASE64 },
    });
    expect(mismatch.statusCode).toBe(415);

    const svg = await app.inject({
      method: 'POST',
      url: '/api/v1/slideshow/photos',
      payload: { content_type: 'image/svg+xml', data_base64: TINY_PNG_BASE64 },
    });
    expect(svg.statusCode).toBe(400);

    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/slideshow/photos',
      payload: { content_type: 'image/png', data_base64: '' },
    });
    expect(empty.statusCode).toBe(400);
  });

  it('deletes an uploaded photo; folder-sourced ids are read-only', async () => {
    const dir = await makePhotosDir({ 'a.png': TINY_PNG });
    await makeApp(
      [
        'ui:',
        '  slideshow:',
        '    sources:',
        '      - id: photos',
        `        path: ${dir}`,
        '',
      ].join('\n'),
    );
    // Upload one photo alongside the folder source.
    const up = await app.inject({
      method: 'POST',
      url: '/api/v1/slideshow/photos',
      payload: { content_type: 'image/png', data_base64: TINY_PNG_BASE64 },
    });
    const m = up.json().manifest as SlideshowManifest;
    const uploaded = m.images.find((i) => i.uploaded)!;
    const folder = m.images.find((i) => !i.uploaded)!;

    // Folder-sourced image can't be deleted.
    const readonly = await app.inject({
      method: 'DELETE',
      url: `/api/v1/slideshow/photos/${folder.id}`,
    });
    expect(readonly.statusCode).toBe(400);

    // Uploaded image can.
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/slideshow/photos/${uploaded.id}`,
    });
    expect(del.statusCode).toBe(200);
    const after = del.json().manifest as SlideshowManifest;
    expect(after.images.some((i) => i.id === uploaded.id)).toBe(false);
    expect(after.images.some((i) => i.id === folder.id)).toBe(true);
  });

  it('404s deleting an unknown id', async () => {
    await makeApp('server:\n  port: 8080\n');
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/slideshow/photos/nope' });
    expect(res.statusCode).toBe(404);
  });
});
