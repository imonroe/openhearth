/**
 * Playwright E2E config (issue #30).
 *
 * Brings up the production-like stack and points the browser at the same URL a
 * kiosk would use (http://localhost:8080):
 *   1. the built OpenHearth server (Node serving the web bundle + API), loading
 *      the deterministic e2e fixture config, and
 *   2. a stub "commercial service" server on a different origin (:8090) that the
 *      launcher navigates to, so the Home/Back return path is exercised for real.
 *
 * Requires a prior `pnpm build` (the `e2e` npm script does this). Browsers are
 * the Playwright-managed Chromium; the Home/Back spec loads the home-guard
 * extension and therefore needs a headed browser (wrap CI in xvfb-run).
 */
import { defineConfig } from '@playwright/test';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const HOME_URL = 'http://localhost:8080';
const STUB_PORT = 8090;

export default defineConfig({
  testDir: here,
  globalSetup: path.join(here, 'global-setup.ts'),
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: HOME_URL,
    trace: 'on-first-retry',
    // Mirror the kiosk launch flag so the player can autostart media without a
    // per-item user gesture (a real OpenHearth kiosk sets this — see #49).
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: [
    {
      // The built OpenHearth server: serves the web bundle + the API on :8080,
      // reading the deterministic e2e fixture config.
      command: 'node packages/server/dist/main.js',
      cwd: repoRoot,
      url: `${HOME_URL}/api/v1/health`,
      // Surface server logs (boot scan summary / cache warnings) in the CI log.
      stdout: 'pipe',
      stderr: 'pipe',
      // Locally we reuse an already-running :8080 to speed iteration; see the
      // README caveat — a dev server on :8080 with a *different* config would be
      // used instead of the fixtures. CI always starts fresh (false).
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        OPENHEARTH_CONFIG_DIR: path.join(here, 'fixtures/config'),
        // Writable cache so the library index (and resume positions) work for
        // the player spec; isolated from any real /cache.
        OPENHEARTH_CACHE_DIR: path.join(here, '.cache'),
        WEB_ROOT: path.join(repoRoot, 'packages/web/dist'),
        PORT: '8080',
        HOST: '127.0.0.1',
        // OPENHEARTH_SEED_DIR is intentionally left unset: the fixture config dir
        // is non-empty, so seedConfigDir() returns 'config-not-empty' and never
        // copies the (absent) default seed over our deterministic catalog.
      },
    },
    {
      // The stub service the launcher navigates to (a foreign origin).
      command: 'node e2e/fixtures/stub-service.mjs',
      cwd: repoRoot,
      url: `http://localhost:${STUB_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { STUB_PORT: String(STUB_PORT) },
    },
  ],
});
