/**
 * Playwright fixture that loads the kiosk `home-guard` browser extension.
 *
 * The cross-service Home/Back guarantee (FR-A3 / NFR-5) lives in the extension,
 * not in the React app: once the kiosk has navigated to a launched service, the
 * SPA is gone and only the extension can bring the kiosk home. To test that for
 * real we must run actual Chromium with the unpacked extension loaded, which
 * requires a persistent context and a headed browser (run under xvfb in CI).
 */
import { test as base, chromium, type BrowserContext } from '@playwright/test';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(here, '../../scripts/kiosk/home-guard');

export const test = base.extend<{ context: BrowserContext }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      // Extensions require a headed browser; CI wraps the run in xvfb-run.
      headless: false,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
  },
});

export { expect } from '@playwright/test';
