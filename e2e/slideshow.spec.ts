/**
 * E2E: the on-demand slideshow (issue #164).
 *
 * Launches the slideshow from the home header and returns from it with the
 * reserved Back key. The e2e fixture config has no photos configured, so the
 * overlay shows its empty state — which still exercises the full launch → render
 * → exit path end to end (the wiring most likely to regress).
 */
import { test, expect } from '@playwright/test';

test.describe('slideshow (on demand)', () => {
  test('launches from the header and returns home on Back', async ({ page }) => {
    await page.goto('/');

    // The header carries a Slideshow action alongside Search and Settings.
    const launch = page.getByRole('button', { name: 'Slideshow' });
    await expect(launch).toBeVisible();
    await launch.click();

    // The full-frame slideshow overlay takes over.
    const overlay = page.locator('.slideshow');
    await expect(overlay).toBeVisible();
    // No photos configured in the fixtures → the empty state, with an exit hint.
    await expect(page.getByText(/No photos yet/i)).toBeVisible();
    await expect(page.getByText(/Press Back to exit/i)).toBeVisible();

    // The reserved Back key returns to the home screen (overlay gone, a focused
    // tile visible again).
    await page.keyboard.press('Backspace');
    await expect(overlay).toHaveCount(0);
    await expect(page.locator('.is-focused')).toHaveCount(1);
  });
});
