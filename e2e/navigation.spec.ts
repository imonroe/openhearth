/**
 * E2E: directional focus navigation across the service grid (issue #30).
 *
 * Runs against the real built app served by the OpenHearth server with the e2e
 * fixture catalog (FakeFlix, StubTube). No extension needed here.
 */
import { test, expect } from '@playwright/test';

test.describe('focus navigation', () => {
  test('seats focus on the first tile and moves it with arrow keys', async ({ page }) => {
    await page.goto('/');

    const fakeflix = page.getByText('FakeFlix', { exact: true });
    const stubtube = page.getByText('StubTube', { exact: true });
    await expect(fakeflix).toBeVisible();

    // Exactly one focused element at all times (design-system §9 rule 1).
    const focused = page.locator('.is-focused');
    await expect(focused).toHaveCount(1);

    // Focus enters on the first service tile.
    const firstTile = page.locator('.tile.tile--service').first();
    await expect(firstTile).toHaveClass(/is-focused/);
    await expect(firstTile).toContainText('FakeFlix');

    // Right moves focus to the next tile…
    await page.keyboard.press('ArrowRight');
    const secondTile = page.locator('.tile.tile--service').nth(1);
    await expect(secondTile).toHaveClass(/is-focused/);
    await expect(secondTile).toContainText('StubTube');
    await expect(firstTile).not.toHaveClass(/is-focused/);
    await expect(page.locator('.is-focused')).toHaveCount(1);

    // …and Left moves it back, clamped at the start.
    await page.keyboard.press('ArrowLeft');
    await expect(firstTile).toHaveClass(/is-focused/);
    await page.keyboard.press('ArrowLeft');
    await expect(firstTile).toHaveClass(/is-focused/);

    // The focused tile carries the amber focus ring: a box-shadow glow on the
    // inner frame (design-system §9 — never "none").
    const glow = await page
      .locator('.tile.is-focused .tile__frame')
      .first()
      .evaluate((el) => getComputedStyle(el).boxShadow);
    expect(glow).not.toBe('none');
    expect(glow).toContain('245, 166, 35'); // amber rgb(245,166,35)

    // Tiles are referenced to silence unused-var lint and assert both rendered.
    await expect(stubtube).toBeVisible();
  });
});
