/**
 * Idle detection for the screensaver (#126).
 *
 * Fires `onIdle` after `timeoutMs` with no user interaction. Any keyboard,
 * mouse, wheel, or touch event resets the countdown. The hook only watches
 * while `enabled` is true, so callers can pause it (e.g. during video playback,
 * or once the screensaver is already showing) by flipping the flag.
 *
 * `onIdle` is read through a ref so changing the callback never re-installs the
 * listeners or restarts the timer — only `timeoutMs`/`enabled` do.
 */
import { useEffect, useRef } from 'react';

/** Interaction events that count as "the user is here" and reset the timer. */
const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'wheel', 'touchstart'] as const;

export interface IdleTimerOptions {
  /** Idle time before `onIdle` fires, in milliseconds. */
  timeoutMs: number;
  /** Watch for idle only while true. When false the hook is fully inert. */
  enabled: boolean;
  /** Called once when the idle threshold is reached. */
  onIdle: () => void;
}

export function useIdleTimer({ timeoutMs, enabled, onIdle }: IdleTimerOptions): void {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => onIdleRef.current(), timeoutMs);
    };

    const onActivity = (event: Event): void => {
      // Ignore zero-distance mousemoves: focus-driven scrolling emits them, and
      // they'd keep the screen awake even though no one touched the mouse (same
      // guard cursorVisibility.ts uses).
      if (event.type === 'mousemove') {
        const me = event as MouseEvent;
        if (me.movementX === 0 && me.movementY === 0) return;
      }
      arm();
    };

    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, onActivity, { passive: true });
    }
    arm();

    return () => {
      if (timer !== undefined) clearTimeout(timer);
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, onActivity);
      }
    };
  }, [timeoutMs, enabled]);
}
