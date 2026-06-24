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
  },
  webServer: [
    {
      // The built OpenHearth server: serves the web bundle + the API on :8080,
      // reading the deterministic e2e fixture config.
      command: 'node packages/server/dist/main.js',
      cwd: repoRoot,
      url: `${HOME_URL}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        OPENHEARTH_CONFIG_DIR: path.join(here, 'fixtures/config'),
        WEB_ROOT: path.join(repoRoot, 'packages/web/dist'),
        PORT: '8080',
        HOST: '127.0.0.1',
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
