/**
 * Screensaver overlay (#126).
 *
 * Renders the selected saver full-screen and waits for the first user
 * interaction to dismiss it. The wake listener runs in the *capture* phase and
 * swallows the triggering event (preventDefault + stopImmediatePropagation), so
 * the key/click that wakes the screen doesn't also navigate or launch something
 * underneath — the user is dropped straight back to the normal interface,
 * exactly where they left off.
 *
 * The caller mounts this in place of the normal screen tree while idle, so
 * there is no other focus/key handler installed at the same time.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import type { ScreensaverType } from '@openhearth/shared';
import { SCREENSAVER_REGISTRY, DEFAULT_SCREENSAVER } from './screensavers';
import './screensaver.css';

/** Events whose arrival means "someone's here" — any one of them wakes. */
const WAKE_EVENTS = ['keydown', 'mousedown', 'mousemove', 'wheel', 'touchstart'] as const;

export function Screensaver({
  type,
  onWake,
}: {
  type: ScreensaverType;
  onWake: () => void;
}): ReactNode {
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;

  useEffect(() => {
    const wake = (event: Event): void => {
      // A zero-distance mousemove (focus-scroll artefact) isn't a real interaction.
      if (event.type === 'mousemove') {
        const me = event as MouseEvent;
        if (me.movementX === 0 && me.movementY === 0) return;
      }
      // Consume the event so the waking input doesn't also act on the UI beneath.
      event.preventDefault();
      event.stopImmediatePropagation();
      onWakeRef.current();
    };
    for (const name of WAKE_EVENTS) {
      window.addEventListener(name, wake, { capture: true, passive: false });
    }
    return () => {
      for (const name of WAKE_EVENTS) {
        window.removeEventListener(name, wake, true);
      }
    };
  }, []);

  const def = SCREENSAVER_REGISTRY[type] ?? SCREENSAVER_REGISTRY[DEFAULT_SCREENSAVER];
  const Saver = def.Component;

  return (
    <div className="screensaver" role="presentation" aria-hidden="true">
      <Saver />
    </div>
  );
}
