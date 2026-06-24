/**
 * Phase 0 server entrypoint.
 *
 * A deliberately minimal HTTP listener so the container has something that
 * responds on :8080. It serves a JSON health probe and, if a built web bundle
 * is present at `WEB_ROOT`, the static SPA (falling back to a placeholder page
 * until the real UI lands). The Fastify app, the versioned API, the WS control
 * endpoint, and structured logging arrive in later phases (1.1/1.2) and replace
 * this stub.
 */
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { banner } from './index.js';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';

const here = path.dirname(fileURLToPath(import.meta.url));
// In the container the web bundle is copied next to the server build; in local
// dev fall back to the sibling web package's dist.
const WEB_ROOT = process.env.WEB_ROOT ?? path.resolve(here, '../public');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const PLACEHOLDER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenHearth</title>
  </head>
  <body style="margin:0;background:#0b0f1a;color:#e8edf7;font-family:system-ui,sans-serif">
    <main style="display:grid;place-items:center;height:100vh;text-align:center">
      <div>
        <h1 style="font-weight:600;letter-spacing:0.02em">OpenHearth</h1>
        <p style="opacity:0.7">Server is running. The web UI bundle is not built yet.</p>
      </div>
    </main>
  </body>
</html>
`;

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Resolve a request path to a file inside WEB_ROOT, guarding against traversal. */
function resolveStatic(urlPath: string): string | null {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const target = path.resolve(WEB_ROOT, rel);
  if (target !== WEB_ROOT && !target.startsWith(WEB_ROOT + path.sep)) return null;
  return fs.existsSync(target) && fs.statSync(target).isFile() ? target : null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/v1/health') {
    sendJson(res, 200, { status: 'ok', service: banner() });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    const file = resolveStatic(url.pathname);
    if (file) {
      const ext = path.extname(file);
      res.writeHead(200, { 'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream' });
      if (req.method === 'HEAD') return void res.end();
      fs.createReadStream(file).pipe(res);
      return;
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PLACEHOLDER_HTML);
      return;
    }
  }

  sendJson(res, 404, { status: 'not_found' });
});

server.listen(PORT, HOST, () => {
  console.log(`${banner()} listening on http://${HOST}:${PORT} (web root: ${WEB_ROOT})`);
});
