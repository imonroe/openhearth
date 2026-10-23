/**
 * Slideshow / digital photo frame overlay (#164).
 *
 * Cycles through the user's photos full-frame. One component serves two entry
 * points; `mode` only changes how it exits:
 *
 *  - `screensaver` — mounted by the idle path in place of a procedural saver.
 *    Any interaction dismisses it (capture-phase, event consumed), exactly like
 *    the Screensaver. With no images it renders `fallback` (the procedural
 *    saver) so the idle screen is never blank.
 *  - `ondemand` — launched from the home header. Back/Home exit; Left/Right step
 *    prev/next; Select or Play/Pause toggles auto-advance. Empty shows a hint.
 *
 * Transitions are pure CSS (see transitions.ts + slideshow.css). Two layers are
 * mounted during a transition: the incoming image (keyed by index so its CSS
 * entrance replays) over the outgoing one when the transition keeps a previous
 * layer (crossfade/wipe). `prefers-reduced-motion` is honored in CSS.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SlideshowManifest } from '@openhearth/shared';
import { slideshowImageUrl } from '../api';
import type { KeyMap } from '../keybindings';
import { resolveTransition } from './transitions';
import { useSlideshowManifest } from './useSlideshowManifest';
import './slideshow.css';

/** Events whose arrival means "someone's here" — any one wakes (screensaver mode). */
const WAKE_EVENTS = ['keydown', 'mousedown', 'mousemove', 'wheel', 'touchstart'] as const;

export interface SlideshowViewProps {
  manifest: SlideshowManifest;
  loading?: boolean;
  mode: 'screensaver' | 'ondemand';
  /** Keybindings for on-demand controls (Back/Home exit, arrows step). */
  keyMap?: KeyMap;
  /** Screensaver mode: called on the first interaction to dismiss. */
  onWake?: () => void;
  /** On-demand mode: called when the user exits (Back/Home). */
  onExit?: () => void;
  /** Screensaver mode: rendered when there are no images (procedural fallback). */
  fallback?: ReactNode;
}

/** Next index for a step, honoring sequential vs. shuffle order. */
function nextIndex(current: number, dir: 1 | -1, count: number, shuffle: boolean): number {
  if (count <= 1) return 0;
  if (shuffle) {
    let n = current;
    while (n === current) n = Math.floor(Math.random() * count);
    return n;
  }
  return (current + dir + count) % count;
}

/** The pure overlay: everything except fetching (so tests pass a manifest in). */
export function SlideshowView({
  manifest,
  loading = false,
  mode,
  keyMap,
  onWake,
  onExit,
  fallback,
}: SlideshowViewProps): ReactNode {
  const images = manifest.images;
  const count = images.length;
  const { intervalSeconds, transition: transitionId, order } = manifest.settings;
  const shuffle = order === 'shuffle';
  const transition = resolveTransition(transitionId);

  const [pos, setPos] = useState<{ index: number; prev: number | null }>({ index: 0, prev: null });
  const [paused, setPaused] = useState(false);

  // Clamp back to the start whenever the image set changes size (reload/delete).
  useEffect(() => {
    setPos({ index: 0, prev: null });
  }, [count]);

  const advance = useCallback(
    (dir: 1 | -1) => {
      if (count <= 1) return;
      setPos(({ index }) => ({ index: nextIndex(index, dir, count, shuffle), prev: index }));
    },
    [count, shuffle],
  );

  // Auto-advance timer. Disabled while paused or with ≤1 image.
  useEffect(() => {
    if (paused || count <= 1) return;
    const id = window.setInterval(() => advance(1), Math.max(1, intervalSeconds) * 1000);
    return () => window.clearInterval(id);
  }, [paused, count, intervalSeconds, advance]);

  // Preload the next image so a transition never shows a half-decoded frame.
  useEffect(() => {
    if (count <= 1 || shuffle) return; // shuffle's next is unknown ahead of time
    const nI = nextIndex(pos.index, 1, count, false);
    const img = new Image();
    img.src = slideshowImageUrl(images[nI]!.id);
  }, [pos.index, count, shuffle, images]);

  // Screensaver mode: any interaction dismisses. Skipped when we're rendering the
  // procedural fallback (it owns its own wake handler).
  const renderingFallback = mode === 'screensaver' && count === 0 && fallback != null;
  useEffect(() => {
    if (mode !== 'screensaver' || renderingFallback) return;
    const wake = (event: Event): void => {
      if (event.type === 'mousemove') {
        const me = event as MouseEvent;
        if (me.movementX === 0 && me.movementY === 0) return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      onWake?.();
    };
    for (const name of WAKE_EVENTS) {
      window.addEventListener(name, wake, { capture: true, passive: false });
    }
    return () => {
      for (const name of WAKE_EVENTS) window.removeEventListener(name, wake, true);
    };
  }, [mode, renderingFallback, onWake]);

  // On-demand controls: Back/Home exit, Left/Right step, Select/Play-Pause toggles.
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  useEffect(() => {
    if (mode !== 'ondemand') return;
    const onKey = (event: KeyboardEvent): void => {
      const bound = keyMap?.get(event.key)?.action;
      const isExit =
        bound === 'home' ||
        bound === 'back' ||
        event.key === 'Escape' ||
        event.key === 'Backspace' ||
        event.key === 'Home';
      if (isExit) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onExitRef.current?.();
        return;
      }
      if (bound === 'navigate') {
        const dir = keyMap?.get(event.key)?.params?.direction;
        if (dir === 'left' || dir === 'right') {
          event.preventDefault();
          event.stopImmediatePropagation();
          advance(dir === 'left' ? -1 : 1);
        }
        return;
      }
      if (bound === 'select' || bound === 'play_pause') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setPaused((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, true);
  }, [mode, keyMap, advance]);

  // Empty screensaver → the procedural fallback fills the idle frame.
  if (renderingFallback) return <>{fallback}</>;

  // Empty on-demand (or a still-loading first paint) → a calm placeholder.
  if (count === 0) {
    return (
      <div className={`slideshow slideshow--empty`} role="presentation">
        {!loading && mode === 'ondemand' ? (
          <div className="slideshow__empty">No photos yet — add some in Settings</div>
        ) : null}
        {mode === 'ondemand' ? <div className="slideshow__hint">Press Back to exit</div> : null}
      </div>
    );
  }

  const showPrev = transition.keepPrevious && pos.prev !== null && pos.prev !== pos.index;
  // In screensaver mode a slow, continuous pan keeps every pixel moving so a
  // long-dwelling still can't burn into the panel (the reason a screensaver
  // exists at all). Functional motion, like the Aurora saver's.
  const motionClass = mode === 'screensaver' ? 'slideshow--motion' : '';
  return (
    <div
      className={`slideshow ${motionClass}`}
      role="presentation"
      aria-hidden={mode === 'screensaver'}
    >
      {showPrev ? (
        <img
          className="slideshow__image slideshow__image--prev"
          src={slideshowImageUrl(images[pos.prev!]!.id)}
          alt=""
          draggable={false}
        />
      ) : null}
      <img
        key={pos.index}
        className={`slideshow__image ${transition.enterClass}`}
        src={slideshowImageUrl(images[pos.index]!.id)}
        alt=""
        draggable={false}
      />
      {mode === 'ondemand' ? (
        <div className="slideshow__hint">{paused ? 'Paused · ' : ''}Press Back to exit</div>
      ) : null}
    </div>
  );
}

/** The overlay wired to the live manifest (used by the app). */
export function Slideshow(props: Omit<SlideshowViewProps, 'manifest' | 'loading'>): ReactNode {
  const { manifest, loading } = useSlideshowManifest();
  return <SlideshowView manifest={manifest} loading={loading} {...props} />;
}
