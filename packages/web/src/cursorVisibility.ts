/**
 * Cursor visibility controller.
 *
 * OpenHearth is a 10-foot, keyboard/remote-driven UI, so the OS cursor is hidden
 * by default (`body { cursor: none }` in index.css). That makes sense on a TV, but
 * is hostile when someone is testing in a desktop browser and wants to click things
 * (see issue #102).
 *
 * This module bridges the two modes: when the user moves the mouse, the cursor
 * reappears (by adding `.cursor-visible` to `<body>`); when they go back to the
 * keyboard/remote, it hides again. The cursor is also hidden after a period of
 * mouse inactivity so it never lingers over the TV UI.
 */

const VISIBLE_CLASS = 'cursor-visible';

/** Hide the cursor after this many ms of no mouse movement. */
const IDLE_TIMEOUT_MS = 5000;

export interface CursorVisibilityController {
  /** Detach all listeners and timers. Restores the keyboard-mode default. */
  dispose(): void;
}

/**
 * Wire up mouse/keyboard listeners that toggle cursor visibility on `<body>`.
 * Safe to call once at startup. Returns a controller so tests (and HMR) can
 * tear it down.
 */
export function initCursorVisibility(doc: Document = document): CursorVisibilityController {
  const body = doc.body;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const hide = (): void => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
    body.classList.remove(VISIBLE_CLASS);
  };

  const show = (): void => {
    body.classList.add(VISIBLE_CLASS);
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(hide, IDLE_TIMEOUT_MS);
  };

  // A real mouse move reveals the cursor. (Programmatic/zero-movement events are
  // ignored so focus-driven scrolling doesn't flash the cursor.)
  const onMouseMove = (event: MouseEvent): void => {
    if (event.movementX === 0 && event.movementY === 0) return;
    show();
  };

  // Any keyboard/remote input means we're back in 10-foot mode: hide the cursor.
  const onKeyDown = (): void => {
    hide();
  };

  doc.addEventListener('mousemove', onMouseMove, { passive: true });
  doc.addEventListener('keydown', onKeyDown);

  return {
    dispose(): void {
      doc.removeEventListener('mousemove', onMouseMove);
      doc.removeEventListener('keydown', onKeyDown);
      hide();
    },
  };
}
