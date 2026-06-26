/**
 * Stub "commercial service" server for E2E.
 *
 * Stands in for a launched service (Netflix/YouTube/…) on a DIFFERENT origin
 * than the OpenHearth app, so the kiosk home-guard extension treats it as a
 * foreign page and its Home/Back interception is exercised for real. It serves
 * one self-identifying page and deliberately installs its OWN bubble-phase
 * keydown handler: if the extension ever failed to intercept, this handler would
 * mark the key as "reached the service" — letting a test prove containment.
 *
 * With `?embed=1` it serves a page that hosts a CROSS-ORIGIN <iframe> player
 * (the iframe loads the same server via 127.0.0.1 while the parent is on
 * localhost — different origins). `?inner=1` is that inner player page. This lets
 * the E2E exercise the case where the reserved key fires inside a foreign-origin
 * frame and the extension must navigate the whole tab via its background worker.
 *
 * Plain Node http, no deps. Port via STUB_PORT (default 8090).
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_PORT ?? 8090);

// Cross-origin host for the embedded iframe: the parent page is served from
// localhost, the iframe from 127.0.0.1 (same server, different origin).
const CROSS_ORIGIN_HOST = '127.0.0.1';

// Page-level keydown recorder: if the extension fails to intercept, the reserved
// key reaches this handler and is recorded — a test can then fail loudly.
const RECORD_KEYS_SCRIPT = `
      window.addEventListener('keydown', (e) => {
        if (['Home', 'BrowserHome', 'BrowserBack'].includes(e.key)) {
          document.getElementById('reached-service-keys').textContent += e.key + ' ';
        }
      });`;

const page = (service) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${service} — stub service</title>
  </head>
  <body data-stub-service="${service}">
    <h1 id="service-name">${service}</h1>
    <p>Pretend commercial service player. Press Home to return to OpenHearth.</p>
    <div id="reached-service-keys"></div>
    <script>${RECORD_KEYS_SCRIPT}
    </script>
  </body>
</html>`;

// Inner player page, loaded cross-origin inside the parent's iframe. Exposes a
// focusable element so a test can move focus into the frame before pressing Home.
const innerPage = (service) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${service} — embedded player</title>
  </head>
  <body data-stub-service="${service}">
    <button id="inner-focus">embedded ${service} player</button>
    <div id="reached-service-keys"></div>
    <script>${RECORD_KEYS_SCRIPT}
    </script>
  </body>
</html>`;

// Parent page that hosts the cross-origin iframe player.
const embedPage = (service, port) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${service} — stub service (embedded)</title>
  </head>
  <body data-stub-service="${service}">
    <h1 id="service-name">${service}</h1>
    <div id="reached-service-keys"></div>
    <iframe
      id="player-frame"
      title="player"
      src="http://${CROSS_ORIGIN_HOST}:${port}/?inner=1&service=${encodeURIComponent(service)}"
      style="width: 80vw; height: 60vh; border: 0"
    ></iframe>
    <script>${RECORD_KEYS_SCRIPT}
    </script>
  </body>
</html>`;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const service = url.searchParams.get('service') ?? 'FakeFlix';
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  if (url.searchParams.has('inner')) {
    res.end(innerPage(service));
  } else if (url.searchParams.has('embed')) {
    res.end(embedPage(service, PORT));
  } else {
    res.end(page(service));
  }
});

server.listen(PORT, () => {
  console.log(`stub service listening on http://localhost:${PORT}`);
});
