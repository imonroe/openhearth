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
// frame (all_frames), and always navigates the TOP window, so pressing Home while
// focus is inside a service's iframe still returns the whole kiosk to OpenHearth.
//
// Configuration (home URL, return keys, debug logging) lives in config.js, which
// runs in this same isolated world just before this file. Edit config.js for
// your deployment — never edit this file.
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
      // Navigate the TOP frame, not just the frame the event fired in — otherwise
      // a key pressed inside a service's iframe would only replace that subframe.
      try {
        window.top.location.assign(HOME_URL);
      } catch {
        // Cross-origin top access can throw in odd sandbox setups; fall back.
        location.assign(HOME_URL);
      }
    },
    true,
  );
})();
