/**
 * Player E2E (#38, FR-C5): start playback of a real local file, pause/seek,
 * exit, and resume. Runs against the built server with a generated H.264/AAC
 * fixture (global-setup). Skips when the fixture is absent (no ffmpeg locally);
 * CI installs ffmpeg so it runs there. No extension needed → default context.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures/media/sample.mp4');

test.describe('player', () => {
  test.skip(!fs.existsSync(fixture), 'media fixture not generated (ffmpeg unavailable)');

  /** From home: down into the library row, open the item, press Play. */
  async function openPlayer(page: Page): Promise<void> {
    await page.goto('/');
    // The library row renders the indexed fixture as a tile.
    await expect(page.locator('.tile--library').first()).toBeVisible();
    await page.keyboard.press('ArrowDown'); // services row → library row
    await expect(page.locator('.tile--library.is-focused')).toBeVisible();
    await page.keyboard.press('Enter'); // open detail
    await expect(page.getByText('Play')).toBeVisible();
    await page.keyboard.press('Enter'); // Play → player
    await expect(page.locator('video.player__video')).toBeVisible();
  }

  test('plays, pauses, and seeks a local file', async ({ page }) => {
    await openPlayer(page);
    const video = page.locator('video.player__video');

    // Playback advances.
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return !!v && v.currentTime > 0.5 && !v.paused;
    });

    // play_pause (space) pauses…
    await page.keyboard.press(' ');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    // …and resumes.
    await page.keyboard.press(' ');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);

    // Seek forward (ArrowRight = +10s).
    const before = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(before + 5);
  });

  test('exits to detail and offers resume on re-entry', async ({ page }) => {
    await openPlayer(page);

    // Let playback get past the 1s "treat as start" threshold, then exit.
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return !!v && v.currentTime > 1.5;
    });
    await page.keyboard.press('Escape'); // Back → save position + exit to detail
    await expect(page.getByText('Play')).toBeVisible();

    // Re-enter → the player offers to resume from the saved position.
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Resume from/)).toBeVisible();
  });
});
