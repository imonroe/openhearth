import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION } from '@openhearth/shared';
import { buildApp } from './app.js';
import { ConfigService } from './core/ConfigService.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let dir: string;
let cfg: ConfigService;
let app: FastifyInstance;
let iconsDirs: string[] = [];

async function makeApp(
  yaml?: string,
  files: Record<string, string> = {},
  opts: { iconsDir?: string } = {},
): Promise<void> {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-app-'));
  if (yaml !== undefined) fs.writeFileSync(path.join(dir, 'openhearth.yaml'), yaml);
  for (const [rel, contents] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  cfg = new ConfigService({ configDir: dir });
  await cfg.load();
  app = buildApp({
    configService: cfg,
    logLevel: 'silent',
    ...(opts.iconsDir ? { iconsDir: opts.iconsDir } : {}),
  });
  await app.ready();
}

afterEach(async () => {
  await app?.close();
  await cfg?.stop();
  await fsp.rm(dir, { recursive: true, force: true });
  for (const d of iconsDirs) await fsp.rm(d, { recursive: true, force: true });
  iconsDirs = [];
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

  it('reports readiness + component diagnostics (#48)', async () => {
    const body = (await app.inject({ url: '/api/v1/health' })).json();
    expect(body.ready).toBe(true);
    expect(body.config).toEqual({ valid: true, errors: 0 });
    // No library/metadata services wired in this app → sensible defaults.
    expect(body.library).toEqual({ enabled: false, items: 0 });
    expect(body.metadata).toEqual({ provider: null });
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

  // --- bundled icon set (issue #108) ---
  async function makeIconsDir(files: Record<string, string>): Promise<string> {
    const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-icons-'));
    for (const [name, contents] of Object.entries(files))
      fs.writeFileSync(path.join(d, name), contents);
    iconsDirs.push(d);
    return d;
  }

  it('serves a bundled SVG icon for icon: bundled:<slug>', async () => {
    const icons = await makeIconsDir({
      'netflix.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    });
    await makeApp(
      '{}',
      {
        'services.yaml':
          'services:\n  - { id: netflix, name: Netflix, launch_url: "https://x/", icon: "bundled:netflix" }\n',
      },
      { iconsDir: icons },
    );
    const res = await app.inject({ method: 'GET', url: '/api/v1/services/netflix/icon' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.body).toContain('<svg');
  });

  it('maps the service id, not the slug, in the route (bundled:<slug> is independent)', async () => {
    const icons = await makeIconsDir({ 'max.svg': '<svg/>' });
    await makeApp(
      '{}',
      {
        // A service whose id differs from the bundled slug it points at.
        'services.yaml':
          'services:\n  - { id: hbo, name: HBO, launch_url: "https://x/", icon: "bundled:max" }\n',
      },
      { iconsDir: icons },
    );
    const res = await app.inject({ method: 'GET', url: '/api/v1/services/hbo/icon' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<svg');
  });

  it('404s a bundled icon when no icons dir is configured', async () => {
    await makeApp('{}', {
      'services.yaml':
        'services:\n  - { id: netflix, name: Netflix, launch_url: "https://x/", icon: "bundled:netflix" }\n',
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/services/netflix/icon' });
    expect(res.statusCode).toBe(404);
  });

  it('404s a bundled icon whose file is missing from the set', async () => {
    const icons = await makeIconsDir({ 'netflix.svg': '<svg/>' });
    await makeApp(
      '{}',
      {
        'services.yaml':
          'services:\n  - { id: ghost, name: Ghost, launch_url: "https://x/", icon: "bundled:ghost" }\n',
      },
      { iconsDir: icons },
    );
    const res = await app.inject({ method: 'GET', url: '/api/v1/services/ghost/icon' });
    expect(res.statusCode).toBe(404);
  });

  it('the seeded config.example icon set is complete (every bundled:<slug> has a file)', async () => {
    const repoRoot = path.resolve(here, '../../..');
    const seedDir = path.join(repoRoot, 'config.example');
    const iconsDir = path.join(repoRoot, 'assets', 'service-icons');
    const yaml = [
      fs.readFileSync(path.join(seedDir, 'services.yaml'), 'utf8'),
      ...fs
        .readdirSync(path.join(seedDir, 'services.d'))
        .filter((f) => f.endsWith('.yaml'))
        .map((f) => fs.readFileSync(path.join(seedDir, 'services.d', f), 'utf8')),
    ].join('\n');
    const slugs = [...yaml.matchAll(/icon:\s*bundled:([a-z0-9-]+)/g)].map((m) => m[1]!);
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) {
      expect(fs.existsSync(path.join(iconsDir, `${slug}.svg`)), `missing ${slug}.svg`).toBe(true);
    }
  });
});

describe('unknown routes', () => {
  beforeEach(() => makeApp('{}'));

  it('404s unknown API routes as JSON', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
  });
});

// A real 1×1 transparent PNG (valid signature) for upload tests (#118).
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('UI settings & wallpaper (#118)', () => {
  beforeEach(() => makeApp('server:\n  port: 8080\n'));

  it('PUT /api/v1/ui/settings persists theme + wallpaper opacity', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/ui/settings',
      payload: { theme: 'light', wallpaper: { enabled: true, opacity: 0.5 } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.config.ui.theme).toBe('light');
    expect(body.config.ui.wallpaper).toEqual({ enabled: true, opacity: 0.5 });
    // It actually hit the config service (subsequent GET reflects it).
    const cfgRes = await app.inject({ method: 'GET', url: '/api/v1/config' });
    expect(cfgRes.json().config.ui.theme).toBe('light');
  });

  it('PUT /api/v1/ui/settings rejects an out-of-range opacity', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/ui/settings',
      payload: { wallpaper: { opacity: 2 } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT /api/v1/ui/settings rejects a free-form image path', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/ui/settings',
      payload: { wallpaper: { image: '../../etc/passwd' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('uploads a wallpaper, then serves it; config points at the stored file', async () => {
    const up = await app.inject({
      method: 'POST',
      url: '/api/v1/ui/wallpaper',
      payload: { content_type: 'image/png', data_base64: TINY_PNG_BASE64 },
    });
    expect(up.statusCode).toBe(200);
    const image = up.json().image as string;
    expect(image).toMatch(/^wallpaper\/background-\d+\.png$/);
    expect(up.json().config.ui.wallpaper.enabled).toBe(true);
    // The file is on disk under config/wallpaper/.
    expect(fs.existsSync(path.join(dir, image))).toBe(true);

    const get = await app.inject({ method: 'GET', url: '/api/v1/ui/wallpaper' });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toContain('image/png');
    expect(get.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects an image whose bytes do not match the declared type', async () => {
    // PNG bytes declared as WebP → magic-byte check fails.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ui/wallpaper',
      payload: { content_type: 'image/webp', data_base64: TINY_PNG_BASE64 },
    });
    expect(res.statusCode).toBe(415);
  });

  it('rejects a non-image payload (bad magic bytes)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ui/wallpaper',
      // "hello" base64 — not a PNG.
      payload: { content_type: 'image/png', data_base64: 'aGVsbG8=' },
    });
    expect(res.statusCode).toBe(415);
  });

  it('rejects a disallowed content type at the schema', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ui/wallpaper',
      payload: { content_type: 'image/svg+xml', data_base64: TINY_PNG_BASE64 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/v1/ui/wallpaper is 404 when none is set', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ui/wallpaper' });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE removes the wallpaper file and clears the config', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/ui/wallpaper',
      payload: { content_type: 'image/png', data_base64: TINY_PNG_BASE64 },
    });
    const del = await app.inject({ method: 'DELETE', url: '/api/v1/ui/wallpaper' });
    expect(del.statusCode).toBe(200);
    expect(del.json().config.ui.wallpaper.enabled).toBe(false);
    const get = await app.inject({ method: 'GET', url: '/api/v1/ui/wallpaper' });
    expect(get.statusCode).toBe(404);
  });

  it('blocks a hand-edited traversal path when serving the image', async () => {
    // A malicious/typo'd ui.wallpaper.image must not escape the config dir.
    await makeApp('ui:\n  wallpaper:\n    enabled: true\n    image: "../escape.png"\n');
    const res = await app.inject({ method: 'GET', url: '/api/v1/ui/wallpaper' });
    expect([400, 404]).toContain(res.statusCode);
  });
});
