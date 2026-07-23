/**
 * useSlideshowManifest (#164) — fetch the slideshow manifest (image ids +
 * playback settings) and expose a `reload` to refetch after an upload/delete.
 * Failure is non-fatal: it resolves to an empty manifest so the overlay can fall
 * back (screensaver mode) or show its empty state (on-demand).
 */
import { useCallback, useEffect, useState } from 'react';
import type { SlideshowManifest } from '@openhearth/shared';
import {
  SLIDESHOW_DEFAULT_INTERVAL_SECONDS,
  SLIDESHOW_DEFAULT_ORDER,
  SLIDESHOW_DEFAULT_TRANSITION,
} from '@openhearth/shared';
import { fetchSlideshowManifest } from '../api';

const EMPTY_MANIFEST: SlideshowManifest = {
  images: [],
  settings: {
    intervalSeconds: SLIDESHOW_DEFAULT_INTERVAL_SECONDS,
    transition: SLIDESHOW_DEFAULT_TRANSITION,
    order: SLIDESHOW_DEFAULT_ORDER,
  },
};

export interface SlideshowManifestState {
  manifest: SlideshowManifest;
  loading: boolean;
  reload: () => void;
}

export function useSlideshowManifest(): SlideshowManifestState {
  const [manifest, setManifest] = useState<SlideshowManifest>(EMPTY_MANIFEST);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    // Guard every state write: aborting a superseded fetch still rejects its
    // promise, so without this an older (or aborted) response could overwrite a
    // newer manifest — or the abort's rejection could wrongly flip to empty.
    let alive = true;
    setLoading(true);
    fetchSlideshowManifest(controller.signal)
      .then((m) => {
        if (alive) setManifest(m);
      })
      .catch(() => {
        if (alive) setManifest(EMPTY_MANIFEST);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [nonce]);

  return { manifest, loading, reload };
}
