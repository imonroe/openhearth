// OpenHearth Home Guard — content script (FR-A3 / NFR-5).
//
// Once OpenHearth launches a commercial service, that service becomes the
// top-level page and the OpenHearth SPA is no longer running — so the in-app
// reserved-key handling can't fire. This content script runs on every page at
// document_start and intercepts the reserved Home/Back key BEFORE the service
// page can see it, then navigates the kiosk back to OpenHearth.
//
// The listener is registered at document_start (before page scripts run) in the
// extension's isolated world, on the capture phase, and calls
// stopImmediatePropagation() — so it runs before the service page's own
// (later-registered) handlers and they never receive the event. It runs in every
// frame (all_frames), and brings the whole tab back to OpenHearth (see the
// background-worker note below), so pressing Home while focus is inside a
// service's iframe still returns the entire kiosk to OpenHearth.
//
// Configuration (home URL, return keys, debug logging) lives in config.js, which
// runs in this same isolated world just before this file. Edit config.js for
// your deployment — never edit this file.
//
// Navigation back to OpenHearth is delegated to the background service worker
// (background.js): it calls chrome.tabs.update on the whole tab, which works even
// when the reserved key was pressed inside a service's cross-origin <iframe> —
// where this content script cannot reach window.top to navigate it. If the
// extension messaging channel is unavailable, we fall back to navigating the top
// frame directly.
const RETURN_MESSAGE = 'openhearth-home-guard:return';

(() => {
  const cfg = globalThis.OPENHEARTH_HOME_GUARD ?? {};
  const HOME_URL = typeof cfg.homeUrl === 'string' ? cfg.homeUrl : 'http://localhost:8080/';
  // `home` always returns to OpenHearth. `BrowserBack` is the cross-service back
  // (Escape/Backspace are intentionally NOT hijacked here — services use them for
  // fullscreen/overlays; they are in-app navigation only). RETURN_KEYS mirrors
  // packages/web/src/reserved.ts and is overridable in config.js for devices
  // whose Home/Back button emits a different key.
  const RETURN_KEYS =
    Array.isArray(cfg.returnKeys) && cfg.returnKeys.length > 0
      ? cfg.returnKeys
      : ['Home', 'BrowserHome', 'BrowserBack'];
  const DEBUG = cfg.debug === true;

  let homeOrigin;
  try {
    homeOrigin = new URL(HOME_URL).origin;
  } catch {
    // A malformed homeUrl shouldn't break the guard everywhere — fall back to the
    // default origin so Home still works on the common single-box setup.
    homeOrigin = 'http://localhost:8080';
  }
  // On OpenHearth's own pages, let the SPA handle Home/Back in-app.
  if (location.origin === homeOrigin) return;

  // Bring the WHOLE TAB back to OpenHearth.
  //
  // Common case — the reserved key fired in the TOP frame (the service is the
  // top-level page): navigate it directly and synchronously. This is the path the
  // must-pass guarantee relies on, so we deliberately keep it free of any
  // dependency on the background worker.
  //
  // Cross-origin subframe case — the key fired inside a service's foreign-origin
  // <iframe> (e.g. some players host the video in one). From that frame we can't
  // touch window.top to navigate it, so we ask the background worker to
  // chrome.tabs.update the whole tab. If messaging is somehow unavailable, we fall
  // back to setting window.top.location.href (assigning href is permitted on a
  // cross-origin top frame during a user-activated event; assign() is not).
  const returnToOpenHearth = () => {
    if (window.top === window) {
      location.href = HOME_URL;
      return;
    }
    try {
      if (globalThis.chrome?.runtime?.id) {
        chrome.runtime.sendMessage({ type: RETURN_MESSAGE, homeUrl: HOME_URL }, () => {
          // Reading lastError suppresses the "receiving end does not exist"
          // console warning if the worker isn't reachable; the fallback covers it.
          void chrome.runtime.lastError;
        });
        return;
      }
    } catch {
      // fall through to a direct top-frame navigation
    }
    try {
      window.top.location.href = HOME_URL;
    } catch {
      location.href = HOME_URL;
    }
  };

  window.addEventListener(
    'keydown',
    (event) => {
      if (DEBUG) {
        // Help users discover what their remote/keyboard emits so they can add it
        // to returnKeys in config.js. Logged from a service page only.
        console.log(
          '[OpenHearth Home Guard] keydown key=%o%s',
          event.key,
          RETURN_KEYS.includes(event.key) ? ' (returns to OpenHearth)' : '',
        );
      }
      if (!RETURN_KEYS.includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      returnToOpenHearth();
    },
    true,
  );
})();
