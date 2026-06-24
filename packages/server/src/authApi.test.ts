/**
 * Shared-token auth over the API/WS (#47, PRD §17). With no token the API is
 * open (non-breaking default); with a token, /api requests need it (header or
 * ?token=), /control/command also accepts the reserved `auth` field, health
 * stays open, the WS upgrade is gated, and /config redacts the token.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Writable } from 'node:stream';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION, REDACTED } from '@openhearth/shared';
import { buildApp } from './app.js';
import { ConfigService } from './core/ConfigService.js';

let dir: string;
let cfg: ConfigService;
let app: FastifyInstance;
const TOKEN = 's3cret-token';

/** A writable that accumulates everything the logger emits. */
function captureStream(): { stream: Writable; text: () => string } {
  let buf = '';
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      buf += chunk.toString();
      cb();
    },
  });
  return { stream, text: () => buf };
}

async function makeApp(
  withToken: boolean,
  opts: { logDestination?: Writable; logLevel?: string } = {},
): Promise<void> {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-auth-'));
  if (withToken) {
    await fsp.writeFile(
      path.join(dir, 'openhearth.yaml'),
      `server:\n  auth:\n    token: ${TOKEN}\n`,
    );
  }
  cfg = new ConfigService({ configDir: dir });
  await cfg.load();
  app = buildApp({
    configService: cfg,
    logLevel: opts.logLevel ?? 'silent',
    ...(opts.logDestination ? { logDestination: opts.logDestination } : {}),
  });
  await app.ready();
}

function command() {
  return {
    type: 'command' as const,
    protocol_version: PROTOCOL_VERSION,
    action: 'home' as const,
  };
}

afterEach(async () => {
  await app?.close();
  await cfg?.stop();
  await fsp.rm(dir, { recursive: true, force: true });
});

describe('no token configured (default) — API is open', () => {
  it('serves /api without any credentials', async () => {
    await makeApp(false);
    expect((await app.inject({ url: '/api/v1/library' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/state' })).statusCode).toBe(200);
    const cmd = await app.inject({
      method: 'POST',
      url: '/api/v1/control/command',
      payload: command(),
    });
    expect(cmd.statusCode).toBe(200);
  });
});

describe('token configured — API/WS require it', () => {
  it('rejects an unauthenticated /api request with 401', async () => {
    await makeApp(true);
    const res = await app.inject({ url: '/api/v1/library' });
    expect(res.statusCode).toBe(401);
    expect(res.json().status).toBe('unauthorized');
  });

  it('accepts the token via Authorization: Bearer and via ?token=', async () => {
    await makeApp(true);
    const byHeader = await app.inject({
      url: '/api/v1/library',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(byHeader.statusCode).toBe(200);
    const byQuery = await app.inject({ url: `/api/v1/library?token=${TOKEN}` });
    expect(byQuery.statusCode).toBe(200);
    const wrong = await app.inject({
      url: '/api/v1/library',
      headers: { authorization: 'Bearer nope' },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('leaves /health open for liveness checks', async () => {
    await makeApp(true);
    expect((await app.inject({ url: '/api/v1/health' })).statusCode).toBe(200);
  });

  it('gates the WS upgrade (401 without the token)', async () => {
    await makeApp(true);
    // A plain GET to the WS path exercises the onRequest gate (no upgrade).
    expect((await app.inject({ url: '/api/v1/control/ws' })).statusCode).toBe(401);
  });

  it('uses exact-path exemptions (no prefix bypass)', async () => {
    await makeApp(true);
    // `/api/v1/healthz` shares the `/api/v1/health` prefix but is NOT the exempt
    // path, so it must be gated (401), not slip through to a 404.
    expect((await app.inject({ url: '/api/v1/healthz' })).statusCode).toBe(401);
  });

  it('never writes the token to the request log, even via ?token= (#47)', async () => {
    const cap = captureStream();
    await makeApp(true, { logDestination: cap.stream, logLevel: 'info' });
    // A request that carries the token in the query string (the WS/header-less path).
    await app.inject({ url: `/api/v1/library?token=${TOKEN}` });
    const logs = cap.text();
    expect(logs).toContain('incoming request'); // the request WAS logged…
    expect(logs).not.toContain(TOKEN); // …but the token was redacted out
    expect(logs).toContain('token=***');
  });

  it('control/command accepts the token in the reserved `auth` field', async () => {
    await makeApp(true);
    const without = await app.inject({
      method: 'POST',
      url: '/api/v1/control/command',
      payload: command(),
    });
    expect(without.statusCode).toBe(401);

    const withAuthField = await app.inject({
      method: 'POST',
      url: '/api/v1/control/command',
      payload: { ...command(), auth: TOKEN },
    });
    expect(withAuthField.statusCode).toBe(200);

    const withHeader = await app.inject({
      method: 'POST',
      url: '/api/v1/control/command',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: command(),
    });
    expect(withHeader.statusCode).toBe(200);
  });

  it('redacts the token from GET /config (never echoed)', async () => {
    await makeApp(true);
    const body = (await app.inject({ url: `/api/v1/config?token=${TOKEN}` })).json();
    expect(body.config.server.auth.token).toBe(REDACTED);
  });
});
