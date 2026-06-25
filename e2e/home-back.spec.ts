/**
 * ★ MUST-PASS E2E: the Home/Back guarantee (FR-A3 / NFR-5, issue #30).
 *
 * Launch a (stubbed, local) commercial service from the grid, then press the
 * reserved Home key and confirm the kiosk returns to the OpenHearth home screen.
 * Once the kiosk has navigated to the service the React app is gone, so this
 * exercises the *extension* layer (scripts/kiosk/home-guard) — the only thing
 * that can bring a launched service back. If this ever regresses, the whole
 * "replace the box" promise breaks, so it is a required check.
 *
 * Uses the extension fixture (loads home-guard into a headed Chromium).
 */
import { test, expect } from './fixtures/extension';

const HOME_ORIGIN = 'http://localhost:8080';
const STUB_ORIGIN = 'http://localhost:8090';

async function launchFakeFlix(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${HOME_ORIGIN}/`);
  await expect(page.getByText('FakeFlix', { exact: true })).toBeVisible();
  // First tile (FakeFlix) is focused on entry; Enter launches it.
  await expect(page.locator('.tile.tile--service').first()).toHaveClass(/is-focused/);
  await page.keyboard.press('Enter');
  // The kiosk navigates to the foreign service origin.
  await page.waitForURL(`${STUB_ORIGIN}/`);
  await expect(page.locator('#service-name')).toHaveText('FakeFlix');
}

test.describe('Home/Back guarantee (must-pass)', () => {
  test('Home returns to the OpenHearth home from a launched service', async ({ page }) => {
    await launchFakeFlix(page);

    // Press the reserved Home key on the service page.
    await page.keyboard.press('Home');

    // The home-guard extension navigates the top frame back to OpenHearth.
    await page.waitForURL(`${HOME_ORIGIN}/`);
    await expect(page.getByText('FakeFlix', { exact: true })).toBeVisible();
    // Back home, focus is seated again — exactly one focused element.
    await expect(page.locator('.is-focused')).toHaveCount(1);
  });

  for (const key of ['BrowserBack', 'BrowserHome'] as const) {
    test(`the remote browser key (${key}) also returns home`, async ({ page }) => {
      await launchFakeFlix(page);

      // A real TV remote sends BrowserHome/BrowserBack, which the extension also
      // reserves (config.js `returnKeys`) — but Playwright can't synthesize those
      // media keys physically, so dispatch a faithful keydown the extension's
      // window listener will receive.
      await page.evaluate((k) => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
        );
      }, key);

      await page.waitForURL(`${HOME_ORIGIN}/`);
      await expect(page.getByText('FakeFlix', { exact: true })).toBeVisible();
    });
  }

  test('does not hijack Escape/Backspace — those stay with the service', async ({ page }) => {
    // The home-guard deliberately reserves only Home/BrowserHome/BrowserBack;
    // Escape and Backspace belong to the service (fullscreen/overlays/back). They
    // must NOT bounce the kiosk home, or services would be unusable.
    await launchFakeFlix(page);

    await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace');
    // Give any (incorrect) navigation a chance to happen.
    await page.waitForTimeout(300);

    // Still on the service, and the service's own handler saw neither key as a
    // reserved-return key (it only records Home/BrowserHome/BrowserBack).
    expect(new URL(page.url()).origin).toBe(STUB_ORIGIN);
    await expect(page.locator('#reached-service-keys')).toHaveText('');
  });
});
