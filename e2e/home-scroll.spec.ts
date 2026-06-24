/**
 * E2E: rows scroll horizontally to follow focus (issue #113).
 *
 * The fixture Streaming row has more tiles than fit on screen. As focus moves
 * right past the visible edge, the row strip must scroll so the focused tile
 * stays in view — with no native scrollbar. Runs against the real built app.
 */
import { test, expect } from '@playwright/test';

test.describe('horizontal row scrolling', () => {
  test('scrolls the row to keep the focused tile in view', async ({ page }) => {
    await page.goto('/');

    const strip = page.locator('.row__strip').first();
    await expect(strip).toBeVisible();

    // The row genuinely overflows (otherwise the test proves nothing).
    const overflow = await strip.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeGreaterThan(0);

    // The scrollbar is hidden (focus-driven, 10-foot UI): the horizontal
    // scrollbar takes no layout space, so offsetHeight === clientHeight.
    const scrollbarGutter = await strip.evaluate(
      (el) => (el as HTMLElement).offsetHeight - el.clientHeight,
    );
    expect(scrollbarGutter).toBe(0);

    // Focus starts at the first tile; the strip is scrolled fully left.
    await expect(page.locator('.tile.tile--service').first()).toHaveClass(/is-focused/);
    expect(await strip.evaluate((el) => el.scrollLeft)).toBe(0);

    // Walk focus to the last tile; the strip must end up scrolled right.
    const tiles = page.locator('.tile.tile--service');
    const count = await tiles.count();
    for (let i = 0; i < count - 1; i++) {
      await page.keyboard.press('ArrowRight');
    }
    await expect(tiles.last()).toHaveClass(/is-focused/);

    // The strip scrolled (smooth-scroll settles asynchronously, so poll).
    await expect
      .poll(async () => strip.evaluate((el) => el.scrollLeft), { timeout: 5_000 })
      .toBeGreaterThan(0);

    // The focused (last) tile ends up within the strip's viewport (poll while
    // the smooth scroll settles).
    await expect
      .poll(
        async () =>
          page.locator('.tile.tile--service.is-focused').evaluate((tile) => {
            const scroller = tile.closest('.row__strip') as HTMLElement;
            const t = tile.getBoundingClientRect();
            const s = scroller.getBoundingClientRect();
            return t.left >= s.left - 1 && t.right <= s.right + 1;
          }),
        { timeout: 5_000 },
      )
      .toBe(true);

    // Invariant: still exactly one focused element (design-system §9 rule 1).
    await expect(page.locator('.is-focused')).toHaveCount(1);

    // Moving back to the start returns the strip to the left edge.
    for (let i = 0; i < count - 1; i++) {
      await page.keyboard.press('ArrowLeft');
    }
    await expect(tiles.first()).toHaveClass(/is-focused/);
    await expect
      .poll(async () => strip.evaluate((el) => el.scrollLeft), { timeout: 5_000 })
      .toBe(0);
  });
});
