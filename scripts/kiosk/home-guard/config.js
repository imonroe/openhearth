// OpenHearth Home Guard — kiosk configuration.
//
// This is the ONLY file you edit to point the guard at your deployment. It runs
// in the extension's isolated world just before content.js, which reads these
// values — so you never edit content.js. After changing anything here, reload
// the extension (chrome://extensions → reload) or restart the kiosk browser.
globalThis.OPENHEARTH_HOME_GUARD = {
  // The origin OpenHearth is served from. MUST match OPENHEARTH_URL in the
  // launch script (openhearth-kiosk.sh / .bat). A trailing slash is fine. If
  // this doesn't match where the kiosk actually loads OpenHearth, the Home/Back
  // guarantee breaks (the guard can't tell OpenHearth's own pages from a
  // service, and "return" sends you to the wrong origin).
  homeUrl: 'http://localhost:8080/',

  // Keys that, pressed on a launched service page, return to OpenHearth. These
  // are KeyboardEvent.key values. The defaults cover a physical Home button
  // (`Home`) and the media keys a TV remote sends (`BrowserHome`, `BrowserBack`).
  //
  // Many compact Bluetooth keyboard/trackpad combos have NO Home key and emit
  // none of these. If yours doesn't return home, set `debug: true` below, press
  // the button you want to use while a service is open, read the key name it
  // logs to the browser console, and add that string here. Avoid `Escape` and
  // `Backspace` — services use them for fullscreen/overlays/back, so hijacking
  // them makes services unusable.
  returnKeys: ['Home', 'BrowserHome', 'BrowserBack'],

  // Set to true to log every key you press on a service page to the console, so
  // you can discover what your remote/keyboard actually emits. Leave false in
  // production (it logs on every keystroke).
  debug: false,
};
