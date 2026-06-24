// OpenHearth Home Guard — content script (FR-A3 / NFR-5).
//
// Once OpenHearth launches a commercial service, that service becomes the
// top-level page and the OpenHearth SPA is no longer running — so the in-app
// reserved-key handling can't fire. This content script runs on every page at
// document_start and intercepts the reserved Home/Back key BEFORE the service
// page can see it, then navigates the kiosk back to OpenHearth.
//
// Why this can't be shadowed by a service page: the listener is registered at
// document_start (before any page script runs) in the extension's isolated
// world, on the capture phase, and calls stopImmediatePropagation() — so it
// always runs first and the page's own handlers never receive the event.
//
// Edit HOME_URL below if your kiosk serves OpenHearth somewhere other than
// http://localhost:8080. HOME_KEYS mirrors packages/web/src/reserved.ts.
(() => {
  const HOME_URL = 'http://localhost:8080/';
  const HOME_KEYS = ['Home', 'BrowserHome'];
  const BACK_KEYS = ['BrowserBack'];

  const homeOrigin = new URL(HOME_URL).origin;
  // On OpenHearth's own pages, let the SPA handle Home/Back in-app.
  if (location.origin === homeOrigin) return;

  window.addEventListener(
    'keydown',
    (event) => {
      if (HOME_KEYS.includes(event.key) || BACK_KEYS.includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        location.assign(HOME_URL);
      }
    },
    true,
  );
})();
