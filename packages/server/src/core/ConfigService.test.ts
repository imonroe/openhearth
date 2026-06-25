import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ConfigService, interpolateEnv } from './ConfigService.js';

// Hot-reload tests assert the watcher EVENTUALLY fires; correctness never
// depends on how *fast* it does. Under a loaded parallel CI run the poll/inotify
// callback can lag for seconds (a failing run logged 12s+ just to import the
// module), so the budgets below are deliberately generous: they cost nothing on
// the happy path (the change is detected in ~200ms) and only widen the failure
// deadline. RELOAD_WAIT_MS is each helper's internal reject timeout; it must stay
// below RELOAD_TEST_TIMEOUT_MS (the Vitest per-test timeout) so a genuine miss
// surfaces as the helper's clear message instead of an opaque Vitest timeout.
const RELOAD_WAIT_MS = 15_000;
const RELOAD_TEST_TIMEOUT_MS = 20_000;

let dir: string;
let svc: ConfigService | undefined;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-config-'));
});

afterEach(async () => {
  await svc?.stop();
  svc = undefined;
  await fsp.rm(dir, { recursive: true, force: true });
});

function write(file: string, contents: string): void {
  fs.writeFileSync(path.join(dir, file), contents);
}

/** Resolve when the service emits a change whose snapshot satisfies `pred`. */
function waitForChange(
  service: ConfigService,
  pred: (snap: { errors: string[]; config: unknown }) => boolean,
  timeoutMs = RELOAD_WAIT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      service.off('change', onChange);
      reject(new Error('timed out waiting for config change'));
    }, timeoutMs);
    function onChange(snap: { errors: string[]; config: unknown }): void {
      if (pred(snap)) {
        clearTimeout(timer);
        service.off('change', onChange);
        resolve();
      }
    }
    service.on('change', onChange);
  });
}

describe('interpolateEnv', () => {
  it('substitutes ${VAR} from the environment', () => {
    expect(interpolateEnv('key: ${K}', { K: 'secret' })).toBe('key: secret');
  });

  it('uses ${VAR:-default} when unset', () => {
    expect(interpolateEnv('p: ${MISSING:-9000}', {})).toBe('p: 9000');
  });

  it('empties an unset variable with no default', () => {
    expect(interpolateEnv('k: ${NOPE}', {})).toBe('k: ');
  });
});

describe('ConfigService.load', () => {
  it('returns the empty (valid) config when /config is missing entirely', async () => {
    svc = new ConfigService({ configDir: path.join(dir, 'does-not-exist') });
    const snap = await svc.load();
    expect(snap.errors).toEqual([]);
    expect(snap.config).toEqual({});
  });

  it('loads and validates a good openhearth.yaml', async () => {
    write('openhearth.yaml', 'server:\n  port: 8080\n  logLevel: info\n');
    svc = new ConfigService({ configDir: dir });
    const snap = await svc.load();
    expect(snap.errors).toEqual([]);
    expect(snap.config.server).toEqual({ port: 8080, logLevel: 'info' });
  });

  it('interpolates ${VAR} secrets from env', async () => {
    write('openhearth.yaml', 'metadata:\n  tmdbApiKey: ${TMDB_API_KEY}\n');
    svc = new ConfigService({ configDir: dir, env: { TMDB_API_KEY: 'abc123' } });
    const snap = await svc.load();
    expect(snap.config.metadata?.tmdbApiKey).toBe('abc123');
  });

  it('falls back to empty config and reports errors on an invalid first load', async () => {
    write('openhearth.yaml', 'server:\n  port: 70000\n'); // out of range
    svc = new ConfigService({ configDir: dir });
    const snap = await svc.load();
    expect(snap.config).toEqual({}); // last-good (still empty) retained
    expect(snap.errors.some((e) => e.includes('server.port'))).toBe(true);
  });

  it('loads raw services.yaml and services.d overlays', async () => {
    write('services.yaml', 'rows:\n  - id: streaming\n');
    await fsp.mkdir(path.join(dir, 'services.d'));
    write('services.d/netflix.yaml', 'id: netflix\n');
    svc = new ConfigService({ configDir: dir });
    const snap = await svc.load();
    expect(snap.services.base).toEqual({ rows: [{ id: 'streaming' }] });
    expect(snap.services.overlays['netflix.yaml']).toEqual({ id: 'netflix' });
  });
});

describe('ConfigService env-value YAML injection resistance', () => {
  it('does not let a ${VAR} value inject new config structure', async () => {
    // A hostile/garbled env value with YAML-significant characters must stay a
    // scalar — it cannot introduce a new top-level `server:` key.
    write('openhearth.yaml', 'metadata:\n  tmdbApiKey: ${KEY}\n');
    svc = new ConfigService({
      configDir: dir,
      env: { KEY: 'abc\nserver:\n  port: 99999' },
    });
    const snap = await svc.load();
    expect(snap.errors).toEqual([]);
    expect(snap.config.server).toBeUndefined();
    expect(snap.config.metadata?.tmdbApiKey).toBe('abc\nserver:\n  port: 99999');
  });
});

describe('ConfigService hot-reload (NFR-4)', () => {
  // These behavioral tests use native fs events (fast, reliable on the local
  // test fs). Polling — the container default for bind mounts — is covered
  // separately below.
  it(
    'applies a valid edit without restart',
    async () => {
      write('openhearth.yaml', 'server:\n  port: 8080\n');
      svc = new ConfigService({ configDir: dir, debounceMs: 20, usePolling: false });
      await svc.start();
      expect(svc.config.server?.port).toBe(8080);

      const changed = waitForChange(
        svc,
        (s) => (s.config as { server?: { port?: number } }).server?.port === 9090,
      );
      write('openhearth.yaml', 'server:\n  port: 9090\n');
      await changed;
      expect(svc.config.server?.port).toBe(9090);
      expect(svc.errors).toEqual([]);
    },
    RELOAD_TEST_TIMEOUT_MS,
  );

  it(
    'retains last-good services when a services file becomes malformed',
    async () => {
      write('openhearth.yaml', 'server:\n  port: 8080\n');
      write('services.yaml', 'rows:\n  - id: streaming\n');
      svc = new ConfigService({ configDir: dir, debounceMs: 20, usePolling: false });
      await svc.start();
      expect(svc.services.base).toEqual({ rows: [{ id: 'streaming' }] });

      const changed = waitForChange(svc, (s) => s.errors.length > 0);
      write('services.yaml', 'rows:\n  - id: [unclosed\n'); // malformed YAML
      await changed;

      // The good services data survives; only the error is reported.
      expect(svc.services.base).toEqual({ rows: [{ id: 'streaming' }] });
      expect(svc.errors.some((e) => e.includes('services.yaml'))).toBe(true);
    },
    RELOAD_TEST_TIMEOUT_MS,
  );

  // The container default: polling detects host edits across a bind mount where
  // native fs events don't fire. Generous timeout — polling is slower than
  // native events, especially under a loaded parallel test run.
  // This is the one inherently timing-sensitive test in the suite: it drives the
  // real chokidar *polling* loop (uv_fs_poll -> stat on the libuv threadpool).
  // Under peak parallel CI load those stat callbacks can be starved for the
  // entire timeout, so the edit is genuinely never seen — we observed it run the
  // full budget with no detection, while the native-fs-event reload tests above
  // (which cover the same reload logic deterministically) and other polling
  // tests passed. It's environmental flakiness, not a product bug, so we let it
  // retry. The size-changing edit (a `logLevel` line rather than the same-width
  // `9090`) is belt-and-suspenders: it also lets the poll detect via size on a
  // coarse-mtime fs where a same-size edit could be missed.
  it(
    'hot-reloads by polling (container default for bind mounts)',
    { timeout: RELOAD_TEST_TIMEOUT_MS, retry: 3 },
    async () => {
      write('openhearth.yaml', 'server:\n  port: 8080\n');
      svc = new ConfigService({
        configDir: dir,
        debounceMs: 20,
        usePolling: true,
        pollInterval: 60,
      });
      await svc.start();
      expect(svc.config.server?.port).toBe(8080);

      const changed = waitForChange(
        svc,
        (s) => (s.config as { server?: { port?: number } }).server?.port === 9090,
      );
      write('openhearth.yaml', 'server:\n  port: 9090\n  logLevel: warn\n');
      await changed;
      expect(svc.config.server?.port).toBe(9090);
      expect(svc.config.server?.logLevel).toBe('warn');
    },
  );

  it(
    'retains last-good config on an invalid edit and reports the error',
    async () => {
      write('openhearth.yaml', 'server:\n  port: 8080\n');
      svc = new ConfigService({ configDir: dir, debounceMs: 20, usePolling: false });
      await svc.start();

      const changed = waitForChange(svc, (s) => s.errors.length > 0);
      write('openhearth.yaml', 'server:\n  port: not-a-number\n'); // invalid
      await changed;

      // Server stays up on last-good config; the bad value is NOT applied.
      expect(svc.config.server?.port).toBe(8080);
      expect(svc.errors.some((e) => e.includes('server.port'))).toBe(true);
    },
    RELOAD_TEST_TIMEOUT_MS,
  );
});
