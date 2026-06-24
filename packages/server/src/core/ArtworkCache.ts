/**
 * ArtworkCache — download metadata artwork once into the disposable `/cache`
 * (#42; PRD §13.2 "all fetched artwork is cached locally"). The poster URL comes
 * from our own metadata cache, never from a client request, so this is not an
 * open proxy — but it still allowlists the TMDB image host as defense in depth,
 * and ignores anything else.
 *
 * Files are keyed by a hash of the remote URL, so the same poster is fetched
 * once and reused. The cache is derived and disposable: deleting the directory
 * just triggers a re-download on next request. `fetch` is injectable for tests.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Hosts we will fetch artwork from. TMDB's image CDN is the only one in v1. */
const ALLOWED_HOSTS = new Set(['image.tmdb.org']);

/** A cached artwork file ready to serve. */
export interface CachedArtwork {
  path: string;
  contentType: string;
}

const EXT_CONTENT_TYPE: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export interface ArtworkCacheOptions {
  /** Directory under `/cache` to store files in. */
  dir: string;
  fetch?: typeof globalThis.fetch;
}

export class ArtworkCache {
  private readonly dir: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(opts: ArtworkCacheOptions) {
    this.dir = opts.dir;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  /**
   * Ensure the artwork for `remoteUrl` is on disk and return how to serve it, or
   * null when the URL host isn't allowed or the download fails. Idempotent: a
   * file already present is reused without refetching.
   */
  async ensure(remoteUrl: string): Promise<CachedArtwork | null> {
    let url: URL;
    try {
      url = new URL(remoteUrl);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) return null;

    const ext = pickExt(url.pathname);
    const file = path.join(this.dir, hashName(remoteUrl) + ext);
    const contentType = EXT_CONTENT_TYPE[ext] ?? 'application/octet-stream';

    if (await exists(file)) return { path: file, contentType };

    let bytes: Buffer;
    try {
      const res = await this.fetchImpl(remoteUrl);
      if (!res.ok) return null;
      bytes = Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
    await fs.mkdir(this.dir, { recursive: true });
    // Write to a temp file then rename, so a serve never sees a partial file.
    const tmp = `${file}.${hashName(remoteUrl + String(bytes.length))}.tmp`;
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, file);
    return { path: file, contentType };
  }
}

function hashName(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

/** A known image extension from the path, defaulting to `.jpg` (TMDB posters). */
function pickExt(pathname: string): string {
  const ext = path.extname(pathname).toLowerCase();
  return ext in EXT_CONTENT_TYPE ? ext : '.jpg';
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
