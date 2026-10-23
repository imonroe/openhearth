/**
 * E2E: the home-guard extension actually CONSUMES scripts/kiosk/home-guard/config.js
 * (issue #133).
 *
 * The must-pass home-back.spec.ts exercises the default return keys — but those
 * defaults are identical to content.js's hardcoded fallback, so a passing run
 * there can't distinguish "config.js was read" from "content.js fell back to
 * defaults." This spec loads the extension with a NON-default `config.js` and
 * proves the override path: a custom return key works, and a default key
 * (`Home`) no longer does. If the config-reading mechanism ever regresses to the
 * hardcoded fallback, this fails.
 *
 * It builds a throwaway copy of the extension (manifest.json + content.js +
 * background.js, all unchanged) plus a patched config.js, so the committed
 * extension is untouched.
 */
import { test as base, chromium, expect, type BrowserContext } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceExtDir = path.resolve(here, '../scripts/kiosk/home-guard');

const HOME_ORIGIN = 'http://localhost:8080';
const STUB_ORIGIN = 'http://localhost:8090';
// A non-default key Playwright can press physically, used as the sole return key.
const CUSTOM_RETURN_KEY = 'F2';

/** Build a temp copy of the extension whose config.js overrides returnKeys. */
async function buildExtensionWithConfig(returnKeys: string[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'home-guard-cfg-'));
  await fs.copyFile(path.join(sourceExtDir, 'manifest.json'), path.join(dir, 'manifest.json'));
  await fs.copyFile(path.join(sourceExtDir, 'content.js'), path.join(dir, 'content.js'));
  await fs.copyFile(path.join(sourceExtDir, 'background.js'), path.join(dir, 'background.js'));
  await fs.writeFile(
    path.join(dir, 'config.js'),
    `globalThis.OPENHEARTH_HOME_GUARD = ${JSON.stringify({
      homeUrl: `${HOME_ORIGIN}/`,
      returnKeys,
      debug: false,
    })};\n`,
    'utf8',
  );
  return dir;
}

const test = base.extend<{ extDir: string; context: BrowserContext }>({
  extDir: async ({}, use) => {
    const dir = await buildExtensionWithConfig([CUSTOM_RETURN_KEY]);
    await use(dir);
    await fs.rm(dir, { recursive: true, force: true });
  },
  context: async ({ extDir }, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
    });
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
  },
});

async function launchFakeFlix(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${HOME_ORIGIN}/`);
  await expect(page.getByText('FakeFlix', { exact: true })).toBeVisible();
  await expect(page.locator('.tile.tile--service').first()).toHaveClass(/is-focused/);
  await page.keyboard.press('Enter');
  await page.waitForURL(`${STUB_ORIGIN}/`);
  await expect(page.locator('#service-name')).toHaveText('FakeFlix');
}

test.describe('home-guard reads config.js', () => {
  test('a config-defined custom return key returns home', async ({ page }) => {
    await launchFakeFlix(page);

    await page.keyboard.press(CUSTOM_RETURN_KEY);

    await page.waitForURL(`${HOME_ORIGIN}/`);
    await expect(page.getByText('FakeFlix', { exact: true })).toBeVisible();
  });

  test('a default key (Home) does NOT return home when config overrides returnKeys', async ({
    page,
  }) => {
    // config.js replaced the defaults with only F2, so Home must stay with the
    // service. This is what proves config.js — not the hardcoded fallback — is in
    // effect; if the extension ignored config.js, Home would bounce us home and
    // this would fail.
    await launchFakeFlix(page);

    await page.keyboard.press('Home');
    await page.waitForTimeout(300);

    expect(new URL(page.url()).origin).toBe(STUB_ORIGIN);
  });
});
