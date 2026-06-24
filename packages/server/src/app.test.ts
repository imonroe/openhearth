import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION } from '@openhearth/shared';
import { buildApp } from './app.js';
import { ConfigService } from './core/ConfigService.js';

let dir: string;
let cfg: ConfigService;
let app: FastifyInstance;

async function makeApp(yaml?: string): Promise<void> {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-app-'));
  if (yaml !== undefined) fs.writeFileSync(path.join(dir, 'openhearth.yaml'), yaml);
  cfg = new ConfigService({ configDir: dir });
  await cfg.load();
  app = buildApp({ configService: cfg, logLevel: 'silent' });
  await app.ready();
}

afterEach(async () => {
  await app?.close();
  await cfg?.stop();
  await fsp.rm(dir, { recursive: true, force: true });
});

describe('GET /api/v1/health', () => {
  beforeEach(() => makeApp('server:\n  port: 8080\n'));

  it('returns a green status with the protocol version', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.protocol_version).toBe(PROTOCOL_VERSION);
    expect(body.config_valid).toBe(true);
    expect(typeof body.uptime_s).toBe('number');
  });
});

describe('GET /api/v1/config', () => {
  it('returns the effective validated config', async () => {
    await makeApp('server:\n  port: 9090\n  logLevel: debug\n');
    const res = await app.inject({ method: 'GET', url: '/api/v1/config' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.errors).toEqual([]);
    expect(body.config.server).toEqual({ port: 9090, logLevel: 'debug' });
  });

  it('reports validation errors and stays up on an invalid config (NFR-4)', async () => {
    await makeApp('server:\n  port: 70000\n'); // out of range -> last-good empty
    const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(health.statusCode).toBe(200); // server still serves
    const res = await app.inject({ method: 'GET', url: '/api/v1/config' });
    const body = res.json();
    expect(body.valid).toBe(false);
    expect(body.errors.some((e: string) => e.includes('server.port'))).toBe(true);
    expect(body.config).toEqual({}); // last-good retained
  });
});

describe('unknown routes', () => {
  beforeEach(() => makeApp('{}'));

  it('404s unknown API routes as JSON', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
  });
});
