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
import { existsSync, createReadStream, realpathSync, statSync } from 'node:fs';
import { join, resolve, sep, extname } from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  PROTOCOL_VERSION,
  redactConfig,
  commandMessageSchema,
  makeStateEvent,
  LIBRARY_ITEM_KINDS,
  LIBRARY_PAGE_DEFAULT,
  LIBRARY_PAGE_MAX,
  resumeUpdateSchema,
  type EventMessage,
  type LibraryItemKind,
} from '@openhearth/shared';
import type { ConfigService } from './core/ConfigService.js';
import { CatalogService } from './core/CatalogService.js';
import { ControlService } from './core/ControlService.js';
import type { LibraryService } from './core/LibraryService.js';
import type { MediaStreamer } from './core/TranscodeService.js';
import { decidePlayback, parseRange, containerMime } from './core/transcodeDecision.js';

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

function isLibraryKind(value: string): value is LibraryItemKind {
  return (LIBRARY_ITEM_KINDS as readonly string[]).includes(value);
}

/**
 * True when `filePath` resolves (after following symlinks) inside one of the
 * configured library source roots. Blocks symlink escapes from the media mount.
 */
function isWithinLibraryRoots(filePath: string, sources: ReadonlyArray<{ path: string }>): boolean {
  let fileReal: string;
  try {
    fileReal = realpathSync(filePath);
  } catch {
    return false;
  }
  for (const source of sources) {
    let rootReal: string;
    try {
      rootReal = realpathSync(resolve(source.path));
    } catch {
      continue;
    }
    if (fileReal === rootReal || fileReal.startsWith(rootReal + sep)) return true;
  }
  return false;
}

/** Serve a file directly with HTTP range support (206/200/416) for direct-play. */
function sendDirectPlay(
  request: FastifyRequest,
  reply: FastifyReply,
  path: string,
  mime: string,
): FastifyReply {
  const size = statSync(path).size;
  const range = parseRange(request.headers.range, size);
  reply.header('Accept-Ranges', 'bytes').header('Content-Type', mime);

  if (range === 'unsatisfiable') {
    return reply.code(416).header('Content-Range', `bytes */${size}`).send();
  }
  if (range) {
    const { start, end } = range;
    return reply
      .code(206)
      .header('Content-Range', `bytes ${start}-${end}/${size}`)
      .header('Content-Length', end - start + 1)
      .send(createReadStream(path, { start, end }));
  }
  return reply.code(200).header('Content-Length', size).send(createReadStream(path));
}

/**
 * Normalize a query value to a single string. Fastify parses a repeated param
 * (`?source=a&source=b`) into an array; a bare array would otherwise reach the
 * SQL layer and 500. Last value wins, matching duplicate-key intuition.
 */
function oneValue(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[raw.length - 1];
  return raw;
}

/** Parse a query int with a default and inclusive [min,max] clamp. */
function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export interface BuildAppOptions {
  /** Source of the effective config + validation errors. */
  configService: ConfigService;
  /** pino log level; defaults to the config's `server.logLevel` or `info`. */
  logLevel?: string;
  /** Directory of the built web bundle to serve as static files, if present. */
  webRoot?: string;
  /** Optional shared ControlService (defaults to a fresh one). */
  controlService?: ControlService;
  /**
   * Local-media library (issue #31/#32). Optional: when the cache DB can't be
   * opened the server still runs and the library endpoints degrade gracefully
   * (empty listing, 404 detail) rather than erroring.
   */
  libraryService?: LibraryService;
  /**
   * Probes + transcodes local media for the stream endpoint (#34). Optional: a
   * stream request without it (no ffmpeg) is a 503, never a crash.
   */
  streamer?: MediaStreamer;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const { configService, libraryService, streamer } = options;
  const level = options.logLevel ?? configService.config.server?.logLevel ?? 'info';
  const catalog = new CatalogService(configService);
  const control = options.controlService ?? new ControlService();

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

  // --- API: local-media library (FR-C2; issue #32) -----------------------
  // Paginated listing, optionally filtered by source and/or kind. Degrades to
  // an empty page when the library is disabled (cold/unwritable cache).
  app.get<{
    Querystring: {
      source?: string | string[];
      kind?: string | string[];
      limit?: string | string[];
      offset?: string | string[];
    };
  }>('/api/v1/library', async (request, reply) => {
    // Coerce each param to a single string first: Fastify turns a repeated key
    // into an array, which must not reach the SQL layer (would 500).
    const source = oneValue(request.query.source);
    const kind = oneValue(request.query.kind);
    const limit = oneValue(request.query.limit);
    const offset = oneValue(request.query.offset);

    if (kind !== undefined && !isLibraryKind(kind)) {
      return reply.code(400).send({
        status: 'bad_request',
        errors: [`kind must be one of ${LIBRARY_ITEM_KINDS.join(', ')}`],
      });
    }
    const lim = clampInt(limit, LIBRARY_PAGE_DEFAULT, 1, LIBRARY_PAGE_MAX);
    const off = clampInt(offset, 0, 0, Number.MAX_SAFE_INTEGER);

    const filter = {
      ...(source !== undefined ? { source_id: source } : {}),
      ...(kind !== undefined ? { kind } : {}),
    };
    if (!libraryService) {
      return { items: [], total: 0, limit: lim, offset: off };
    }
    const items = libraryService.list({ ...filter, limit: lim, offset: off });
    const total = libraryService.count(filter);
    return { items, total, limit: lim, offset: off };
  });

  // Single item detail (enough to drive the play decision in later phases).
  app.get<{ Params: { id: string } }>('/api/v1/library/:id', async (request, reply) => {
    const item = libraryService?.get(request.params.id);
    if (!item) return reply.code(404).send({ status: 'not_found' });
    return item;
  });

  // Stream an item: direct-play with HTTP range when the browser can play it,
  // else transcode via ffmpeg to fragmented MP4 (FR-C3/FR-C4; PRD §12.1).
  app.get<{ Params: { id: string }; Querystring: { t?: string | string[] } }>(
    '/api/v1/library/:id/stream',
    async (request, reply) => {
      const item = libraryService?.get(request.params.id);
      if (!item) return reply.code(404).send({ status: 'not_found' });
      if (!streamer) {
        // No ffmpeg/transcoder wired (e.g. cache disabled) — usable app, no media.
        return reply.code(503).send({ status: 'unavailable' });
      }
      if (!existsSync(item.path)) {
        return reply.code(404).send({ status: 'not_found' });
      }

      // Containment (defense-in-depth): the file must resolve inside a configured
      // library source root. LibraryService follows symlinks, so without this a
      // planted symlink (e.g. evil.mp4 -> /etc/shadow) could exfiltrate a
      // server-side file through the stream endpoint.
      if (!isWithinLibraryRoots(item.path, configService.config.library?.sources ?? [])) {
        request.log.warn({ path: item.path }, 'stream blocked: outside library roots');
        return reply.code(403).send({ status: 'forbidden' });
      }

      let probe;
      try {
        probe = await streamer.probe(item.path);
      } catch (err) {
        request.log.warn({ err, path: item.path }, 'ffprobe failed');
        return reply.code(502).send({ status: 'probe_failed' });
      }

      if (decidePlayback(probe) === 'direct') {
        return sendDirectPlay(request, reply, item.path, containerMime(probe.container));
      }

      // Transcode: stream fragmented MP4; restart from `t` seconds for seeking.
      const seekSec = clampInt(oneValue(request.query.t), 0, 0, Number.MAX_SAFE_INTEGER);
      const { stream, kill } = streamer.openTranscode(item.path, { seekSec });
      // Kill ffmpeg if the client goes away, so we don't leak processes.
      request.raw.on('close', kill);
      stream.on('error', (err: unknown) => {
        request.log.warn({ err }, 'transcode stream error');
        kill();
      });
      return reply
        .code(200)
        .header('Content-Type', 'video/mp4')
        .header('Cache-Control', 'no-store')
        .send(stream);
    },
  );

  // Resume position for an item (FR-C5). GET returns the saved position (or
  // null), PUT saves it, DELETE forgets it. Keyed by item id in the cache.
  app.get<{ Params: { id: string } }>('/api/v1/library/:id/resume', async (request) => {
    return libraryService?.getResume(request.params.id) ?? null;
  });

  app.put<{ Params: { id: string } }>('/api/v1/library/:id/resume', async (request, reply) => {
    const parsed = resumeUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        status: 'bad_request',
        errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      });
    }
    if (!libraryService?.get(request.params.id)) {
      return reply.code(404).send({ status: 'not_found' });
    }
    libraryService.setResume(request.params.id, parsed.data.position_sec);
    return { status: 'ok' };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/library/:id/resume', async (request) => {
    libraryService?.clearResume(request.params.id);
    return { status: 'ok' };
  });

  // --- Control protocol (PRD §11) ----------------------------------------
  // Shape an envelope validation error into a uniform 400/event payload.
  const validateCommand = (
    raw: unknown,
  ):
    | { ok: true; command: ReturnType<typeof commandMessageSchema.parse> }
    | { ok: false; errors: string[] } => {
    const result = commandMessageSchema.safeParse(raw);
    if (result.success) return { ok: true, command: result.data };
    return {
      ok: false,
      errors: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  };

  // GET current authoritative state snapshot.
  app.get('/api/v1/state', async () => control.getState());

  // REST mirror: apply a single command, return the new state (FR-R2).
  app.post('/api/v1/control/command', async (request, reply) => {
    const parsed = validateCommand(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ status: 'invalid', errors: parsed.errors });
    }
    return { status: 'ok', state: control.dispatch(parsed.command) };
  });

  // WebSocket: bidirectional control channel (FR-R5). Registered inside an
  // encapsulated plugin that awaits @fastify/websocket first, so the plugin's
  // onRoute hook is installed before the `{ websocket: true }` route is added.
  void app.register(async (instance) => {
    // Cap the frame size explicitly — control messages are tiny.
    await instance.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });
    instance.get('/api/v1/control/ws', { websocket: true }, (socket) => {
      const send = (event: EventMessage): void => socket.send(JSON.stringify(event));
      // Send the current state on connect so the client starts authoritative.
      send(makeStateEvent(control.getState()));
      const unsubscribe = control.subscribe({ send });

      socket.on('message', (data: Buffer) => {
        let raw: unknown;
        try {
          raw = JSON.parse(data.toString());
        } catch {
          socket.send(JSON.stringify({ type: 'error', error: 'invalid JSON' }));
          return;
        }
        const parsed = validateCommand(raw);
        if (!parsed.ok) {
          socket.send(
            JSON.stringify({ type: 'error', error: 'invalid command', details: parsed.errors }),
          );
          return;
        }
        control.dispatch(parsed.command); // broadcast goes to all subscribers
      });

      socket.on('close', unsubscribe);
    });
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
