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
 * Plain Node http, no deps. Port via STUB_PORT (default 8090).
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_PORT ?? 8090);

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
    <script>
      // If the home-guard extension fails to intercept, the reserved key reaches
      // this page-level handler and is recorded — a test can then fail loudly.
      window.addEventListener('keydown', (e) => {
        if (['Home', 'BrowserHome', 'BrowserBack'].includes(e.key)) {
          document.getElementById('reached-service-keys').textContent += e.key + ' ';
        }
      });
    </script>
  </body>
</html>`;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const service = url.searchParams.get('service') ?? 'FakeFlix';
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page(service));
});

server.listen(PORT, () => {
  console.log(`stub service listening on http://localhost:${PORT}`);
});
