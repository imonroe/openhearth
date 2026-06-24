/**
 * NFR-4 must-pass: invalid config never crashes the server/UI.
 *
 * These are the behaviors most likely to silently regress, so they get
 * dedicated, end-to-end coverage: a deliberately broken config (committed as a
 * fixture) must leave the server up and serving the last-good config, with the
 * error reported — both on first load and on a hot-reload edit.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { ConfigService } from './core/ConfigService.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'core', '__fixtures__');

/** Resolve on the next config `change` that carries errors; reject if none in time. */
function waitForErrors(svc: ConfigService, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      svc.off('change', onChange);
      reject(new Error('watcher never reported a config with validation errors'));
    }, timeoutMs);
    function onChange(snap: { errors: string[] }): void {
      if (snap.errors.length) {
        clearTimeout(timer);
        svc.off('change', onChange);
        resolve();
      }
    }
    svc.on('change', onChange);
  });
}

let app: FastifyInstance | undefined;
let cfg: ConfigService | undefined;
let tmp: string | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  await cfg?.stop();
  cfg = undefined;
  if (tmp) await fsp.rm(tmp, { recursive: true, force: true });
  tmp = undefined;
});

describe('NFR-4: a deliberately broken config never crashes the server (must-pass)', () => {
  for (const fixture of ['broken-schema', 'broken-yaml']) {
    it(`loads ${fixture} without throwing, retains last-good, reports the error`, async () => {
      cfg = new ConfigService({ configDir: path.join(fixtures, fixture) });
      // Must not throw.
      const snap = await cfg.load();
      expect(snap.errors.length).toBeGreaterThan(0);
      expect(snap.config).toEqual({}); // last-good (empty) retained, not the bad values

      // The server comes up and keeps serving.
      app = buildApp({ configService: cfg, logLevel: 'silent' });
      await app.ready();

      const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(health.statusCode).toBe(200);
      expect(health.json().config_valid).toBe(false);

      const config = await app.inject({ method: 'GET', url: '/api/v1/config' });
      expect(config.statusCode).toBe(200);
      const body = config.json();
      expect(body.valid).toBe(false);
      expect(body.errors.length).toBeGreaterThan(0);
      expect(body.config).toEqual({}); // never the broken values
    });
  }

  // Poll for changes rather than rely on native fs events: polling is the
  // container default (bind mounts) and deterministic, where native events can
  // lag well past the wait under a loaded parallel CI run. Vitest's per-test
  // timeout is raised to comfortably exceed waitForErrors' own budget.
  it('keeps serving last-good after a valid->invalid hot-reload edit', async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-nfr4-'));
    fs.writeFileSync(
      path.join(tmp, 'openhearth.yaml'),
      'server:\n  port: 8080\n  logLevel: warn\n',
    );
    cfg = new ConfigService({ configDir: tmp, debounceMs: 20, usePolling: true, pollInterval: 60 });
    await cfg.start();

    app = buildApp({ configService: cfg, logLevel: 'silent' });
    await app.ready();

    // Good config is served.
    let res = await app.inject({ method: 'GET', url: '/api/v1/config' });
    expect(res.json().config.server.port).toBe(8080);

    // Break it on disk and wait for the watcher to reload (bounded, so a
    // failure surfaces as a clear message rather than an opaque timeout).
    const changed = waitForErrors(cfg);
    fs.writeFileSync(path.join(tmp, 'openhearth.yaml'), 'server:\n  port: 70000\n');
    await changed;

    // Server still up; /config reports the error but keeps the last-good port.
    const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(health.statusCode).toBe(200);

    res = await app.inject({ method: 'GET', url: '/api/v1/config' });
    const body = res.json();
    expect(body.valid).toBe(false);
    expect(body.errors.some((e: string) => e.includes('server.port'))).toBe(true);
    expect(body.config.server.port).toBe(8080); // last-good retained
  }, 10000);

  it('retains last-good services when an overlay becomes malformed (NFR-4)', async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-nfr4-svc-'));
    fs.writeFileSync(path.join(tmp, 'openhearth.yaml'), 'server:\n  port: 8080\n');
    await fsp.mkdir(path.join(tmp, 'services.d'));
    fs.writeFileSync(path.join(tmp, 'services.d', 'netflix.yaml'), 'id: netflix\n');
    cfg = new ConfigService({ configDir: tmp, debounceMs: 20, usePolling: true, pollInterval: 60 });
    await cfg.start();
    expect(cfg.services.overlays['netflix.yaml']).toEqual({ id: 'netflix' });

    // Corrupt the overlay; the watcher reloads and reports a non-fatal error.
    const changed = waitForErrors(cfg);
    fs.writeFileSync(path.join(tmp, 'services.d', 'netflix.yaml'), 'id: [unclosed\n');
    await changed;

    // The good overlay data survives; openhearth.yaml is still valid.
    expect(cfg.services.overlays['netflix.yaml']).toEqual({ id: 'netflix' });
    expect(cfg.config.server?.port).toBe(8080);
  }, 10000);
});
