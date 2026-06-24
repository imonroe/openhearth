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

async function makeApp(yaml?: string, files: Record<string, string> = {}): Promise<void> {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-app-'));
  if (yaml !== undefined) fs.writeFileSync(path.join(dir, 'openhearth.yaml'), yaml);
  for (const [rel, contents] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
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

  it('redacts secrets (never echoes the TMDB key)', async () => {
    await makeApp('metadata:\n  tmdbApiKey: super-secret-key-12345\n');
    const res = await app.inject({ method: 'GET', url: '/api/v1/config' });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('super-secret-key-12345');
    expect(res.json().config.metadata.tmdbApiKey).toBe('***');
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

describe('GET /api/v1/services', () => {
  it('returns the ordered, grouped catalog merged from services.yaml + services.d', async () => {
    await makeApp('{}', {
      'services.yaml':
        'services:\n' +
        '  - { id: netflix, name: Netflix, launch_url: "https://www.netflix.com/", group: Streaming, order: 10 }\n' +
        '  - { id: youtube, name: YouTube, launch_url: "https://www.youtube.com/tv", group: Streaming, order: 20 }\n',
      'services.d/disney.yaml':
        'services:\n  - { id: disney, name: "Disney+", launch_url: "https://www.disneyplus.com/", group: Streaming, order: 30 }\n',
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/services' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.errors).toEqual([]);
    const streaming = body.groups.find((g: { group: string }) => g.group === 'Streaming');
    expect(streaming.services.map((s: { id: string }) => s.id)).toEqual([
      'netflix',
      'youtube',
      'disney', // overlay merged and ordered
    ]);
  });

  it('reports a malformed entry without dropping the rest', async () => {
    await makeApp('{}', {
      'services.yaml':
        'services:\n' +
        '  - { id: ok, name: OK, launch_url: "https://ok.example/" }\n' +
        '  - { id: bad, name: Bad, launch_url: nope }\n',
    });
    const body = (await app.inject({ method: 'GET', url: '/api/v1/services' })).json();
    expect(body.groups.flatMap((g: { services: unknown[] }) => g.services)).toHaveLength(1);
    expect(body.errors.length).toBe(1);
  });
});

describe('GET /api/v1/services/:id/icon', () => {
  it('serves a local icon file from config/', async () => {
    await makeApp('{}', {
      'services.yaml':
        'services:\n  - { id: netflix, name: Netflix, launch_url: "https://www.netflix.com/", icon: netflix.png }\n',
      'netflix.png': 'PNGDATA',
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/services/netflix/icon' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.body).toBe('PNGDATA');
  });

  it('404s when the service has a remote (http) icon', async () => {
    await makeApp('{}', {
      'services.yaml':
        'services:\n  - { id: yt, name: YT, launch_url: "https://www.youtube.com/", icon: "https://cdn/yt.png" }\n',
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/services/yt/icon' });
    expect(res.statusCode).toBe(404);
  });

  it('404s for an unknown service or missing icon', async () => {
    await makeApp('{}', {
      'services.yaml': 'services:\n  - { id: noicon, name: NoIcon, launch_url: "https://x/" }\n',
    });
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/services/noicon/icon' })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/services/ghost/icon' })).statusCode,
    ).toBe(404);
  });

  it('does not serve a non-image config file via the icon route (secret leak)', async () => {
    await makeApp('{}', {
      'services.yaml':
        'services:\n  - { id: leak, name: Leak, launch_url: "https://x/", icon: "secret.yaml" }\n',
      'secret.yaml': 'tmdbApiKey: SUPER-SECRET\n',
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/services/leak/icon' });
    expect(res.statusCode).toBe(404); // .yaml not an allowed image type
    expect(res.body).not.toContain('SUPER-SECRET');
  });

  it('does not serve an SVG icon (inline-script XSS risk)', async () => {
    await makeApp('{}', {
      'services.yaml':
        'services:\n  - { id: svgtile, name: SVG, launch_url: "https://x/", icon: "evil.svg" }\n',
      'evil.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/services/svgtile/icon' });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a symlink that escapes config/ (filesystem-aware guard)', async () => {
    await makeApp('{}', {
      'services.yaml':
        'services:\n  - { id: symtile, name: Sym, launch_url: "https://x/", icon: "escape.png" }\n',
    });
    // Create a file outside config/ and a symlink to it inside config/.
    const outside = path.join(os.tmpdir(), `oh-outside-${process.pid}-${Date.now()}.png`);
    fs.writeFileSync(outside, 'OUTSIDE');
    fs.symlinkSync(outside, path.join(dir, 'escape.png'));
    const res = await app.inject({ method: 'GET', url: '/api/v1/services/symtile/icon' });
    expect(res.statusCode).toBe(400);
    fs.rmSync(outside, { force: true });
  });

  it('sets nosniff and a restrictive CSP on a served icon', async () => {
    await makeApp('{}', {
      'services.yaml':
        'services:\n  - { id: netflix, name: Netflix, launch_url: "https://x/", icon: netflix.png }\n',
      'netflix.png': 'PNG',
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/services/netflix/icon' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });
});

describe('unknown routes', () => {
  beforeEach(() => makeApp('{}'));

  it('404s unknown API routes as JSON', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
  });
});
