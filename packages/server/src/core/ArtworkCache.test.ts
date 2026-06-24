/**
 * ArtworkCache tests (#42) — offline via injected fetch + a temp dir. Covers the
 * host allowlist (SSRF defense), download-once idempotency, content-type from
 * extension, and graceful null on a failed/blocked fetch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ArtworkCache } from './ArtworkCache.js';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-art-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function pngResponse(): Response {
  return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
}

const TMDB = 'https://image.tmdb.org/t/p/w500/poster.jpg';

describe('ArtworkCache', () => {
  it('downloads an allowed TMDB URL once and reuses it', async () => {
    const fetchImpl = vi.fn(async () => pngResponse());
    const cache = new ArtworkCache({ dir, fetch: fetchImpl });

    const first = await cache.ensure(TMDB);
    expect(first?.contentType).toBe('image/jpeg'); // from the .jpg extension
    expect(first && (await fileExists(first.path))).toBe(true);

    const second = await cache.ensure(TMDB);
    expect(second?.path).toBe(first?.path);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // reused, not refetched
  });

  it('rejects a non-allowlisted host without fetching (SSRF defense)', async () => {
    const fetchImpl = vi.fn(async () => pngResponse());
    const cache = new ArtworkCache({ dir, fetch: fetchImpl });
    expect(await cache.ensure('https://evil.example.com/x.jpg')).toBeNull();
    expect(await cache.ensure('http://image.tmdb.org/x.jpg')).toBeNull(); // not https
    expect(await cache.ensure('not a url')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null when the download fails (non-ok / network)', async () => {
    const notFound = new ArtworkCache({
      dir,
      fetch: vi.fn(async () => new Response('', { status: 404 })),
    });
    expect(await notFound.ensure(TMDB)).toBeNull();

    const threw = new ArtworkCache({
      dir,
      fetch: vi.fn(async () => {
        throw new Error('network');
      }),
    });
    expect(await threw.ensure(TMDB)).toBeNull();
  });

  it('maps a .png URL to image/png', async () => {
    const cache = new ArtworkCache({ dir, fetch: vi.fn(async () => pngResponse()) });
    const out = await cache.ensure('https://image.tmdb.org/t/p/w500/x.png');
    expect(out?.contentType).toBe('image/png');
  });
});

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
