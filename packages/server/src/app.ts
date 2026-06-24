/**
 * Fastify application factory.
 *
 * Builds the HTTP app: the versioned API (`/api/v1/...`), and—when a web bundle
 * is present—the static SPA. Separating construction from listening lets tests
 * exercise routes via `app.inject()` without binding a port.
 *
 * Logging is structured JSON to stdout via Fastify's built-in pino, at a
 * configurable level. There is no telemetry and no outbound calls (NFR-9).
 */
import { existsSync, createReadStream, realpathSync } from 'node:fs';
import { join, resolve, sep, extname } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION, redactConfig } from '@openhearth/shared';
import type { ConfigService } from './core/ConfigService.js';
import { CatalogService } from './core/CatalogService.js';

// Raster image types only. SVG is deliberately excluded: it can carry inline
// <script>, and a malicious community services.d/* icon served from this origin
// (which also hosts the API/control WS) would be stored XSS.
const ICON_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export interface BuildAppOptions {
  /** Source of the effective config + validation errors. */
  configService: ConfigService;
  /** pino log level; defaults to the config's `server.logLevel` or `info`. */
  logLevel?: string;
  /** Directory of the built web bundle to serve as static files, if present. */
  webRoot?: string;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const { configService } = options;
  const level = options.logLevel ?? configService.config.server?.logLevel ?? 'info';
  const catalog = new CatalogService(configService);

  const app = Fastify({
    logger: { level },
    // Trust no proxy by default; the kiosk talks to the server directly.
    disableRequestLogging: false,
  });

  // --- API: liveness/readiness -------------------------------------------
  app.get('/api/v1/health', async () => {
    return {
      status: 'ok',
      protocol_version: PROTOCOL_VERSION,
      uptime_s: Math.round(process.uptime()),
      config_valid: configService.errors.length === 0,
    };
  });

  // --- API: effective validated config snapshot --------------------------
  app.get('/api/v1/config', async () => {
    return {
      // Secrets (e.g. metadata.tmdbApiKey) are redacted: this endpoint is
      // unauthenticated, so it must never echo a secret back over the LAN.
      config: redactConfig(configService.config),
      errors: configService.errors,
      valid: configService.errors.length === 0,
    };
  });

  // --- API: service tile catalog (ordered + grouped) ---------------------
  app.get('/api/v1/services', async () => {
    return catalog.getCatalog();
  });

  // --- API: a service's local icon file (from config/) -------------------
  // Remote (http/https) icons are loaded directly by the client; this only
  // serves bare-filename icons that live alongside the YAML in config/.
  app.get<{ Params: { id: string } }>('/api/v1/services/:id/icon', async (request, reply) => {
    const tile = catalog.findService(request.params.id);
    if (!tile?.icon || /^https?:\/\//i.test(tile.icon)) {
      return reply.code(404).send({ status: 'not_found' });
    }

    // Type allowlist: only ever serve known image extensions. This stops the
    // route from streaming arbitrary config files (e.g. icon: "openhearth.yaml",
    // which holds secrets) through the image endpoint.
    const type = ICON_TYPES[extname(tile.icon).toLowerCase()];
    if (!type) {
      return reply.code(404).send({ status: 'not_found' });
    }

    let configReal: string;
    try {
      configReal = realpathSync(resolve(configService.configDir));
    } catch {
      return reply.code(404).send({ status: 'not_found' });
    }
    const target = resolve(configReal, tile.icon);
    // Lexical guard (fast reject) ...
    if (target !== configReal && !target.startsWith(configReal + sep)) {
      return reply.code(400).send({ status: 'bad_request' });
    }
    if (!existsSync(target)) {
      return reply.code(404).send({ status: 'not_found' });
    }
    // ... then a filesystem-aware guard: resolve symlinks and re-check
    // containment, so a symlink inside config/ can't point outside it.
    const real = realpathSync(target);
    if (real !== configReal && !real.startsWith(configReal + sep)) {
      return reply.code(400).send({ status: 'bad_request' });
    }

    return reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'")
      .type(type)
      .send(createReadStream(real));
  });

  // --- Static SPA (optional; placeholder until the real bundle lands) -----
  const webRoot = options.webRoot;
  if (webRoot && existsSync(webRoot)) {
    void app.register(fastifyStatic, { root: webRoot, wildcard: false });
    const hasIndex = existsSync(join(webRoot, 'index.html'));
    // SPA history fallback: any unmatched GET that isn't an API call serves
    // index.html so client-side routes survive a refresh — but only once a real
    // bundle (with index.html) exists. Until then, unmatched routes 404 as JSON.
    app.setNotFoundHandler((req, reply) => {
      if (hasIndex && req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ status: 'not_found' });
    });
  }

  return app;
}
