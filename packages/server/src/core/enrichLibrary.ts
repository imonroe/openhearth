/**
 * Background metadata prime (#42). After a library scan, resolve each unique
 * title through the provider so the metadata cache is populated and artwork is
 * pre-downloaded — the next library load then serves posters from cache without
 * blocking the request path. Runs only when a provider is configured; otherwise
 * it's a no-op and tiles keep their filename titles + placeholders (§13.2).
 *
 * The provider already throttles its own requests, so this serial loop is
 * naturally rate-limited. Per-item failures are reported and skipped — priming
 * is best-effort and never throws into the caller.
 */
import type { LibraryItem } from '@openhearth/shared';
import {
  type MetadataService,
  metadataQueryForLibraryItem,
  metadataCacheKey,
} from './MetadataService.js';
import type { ArtworkCache } from './ArtworkCache.js';

export interface PrimeDeps {
  metadataService: MetadataService;
  artworkCache?: ArtworkCache;
  /** Per-item failure hook (e.g. log at debug). */
  onError?: (err: unknown, item: LibraryItem) => void;
}

/** Resolve + cache metadata (and pre-download artwork) for every unique title. */
export async function primeLibraryMetadata(
  items: readonly LibraryItem[],
  deps: PrimeDeps,
): Promise<number> {
  if (!deps.metadataService.enabled) return 0;
  const seen = new Set<string>();
  let resolved = 0;
  for (const item of items) {
    const query = metadataQueryForLibraryItem(item);
    const key = metadataCacheKey(query);
    if (seen.has(key)) continue; // a 10-episode show resolves once
    seen.add(key);
    try {
      const media = await deps.metadataService.resolveMedia(query);
      if (media) {
        resolved += 1;
        if (deps.artworkCache && media.artwork?.poster_url) {
          await deps.artworkCache.ensure(media.artwork.poster_url);
        }
      }
    } catch (err) {
      deps.onError?.(err, item);
    }
  }
  return resolved;
}
