import { describe, it, expect } from 'vitest';
import { visibleRowRange, windowWithFocus, scrollTopForRow } from './gridWindow';

// Realistic-ish numbers: 200px row pitch, 800px viewport (4 rows visible).
const ROW = 200;
const VIEW = 800;

describe('visibleRowRange (#130)', () => {
  it('returns an empty window for an empty grid', () => {
    expect(visibleRowRange(0, VIEW, ROW, 0, 3)).toEqual({ start: 0, end: 0 });
  });

  it('renders everything when measurements are unavailable (graceful fallback)', () => {
    expect(visibleRowRange(0, 0, 0, 50, 3)).toEqual({ start: 0, end: 50 });
    expect(visibleRowRange(0, VIEW, 0, 50, 3)).toEqual({ start: 0, end: 50 });
    expect(visibleRowRange(0, 0, ROW, 50, 3)).toEqual({ start: 0, end: 50 });
  });

  it('windows around the top with overscan, clamped at row 0', () => {
    // scrollTop 0 → firstVisible 0; visibleRows = ceil(800/200)+1 = 5.
    // start = max(0, 0-3) = 0; end = min(200, 0+5+3) = 8.
    expect(visibleRowRange(0, VIEW, ROW, 200, 3)).toEqual({ start: 0, end: 8 });
  });

  it('windows around a mid-scroll position', () => {
    // scrollTop 20000 → firstVisible 100; start = 97; end = min(200, 100+5+3)=108.
    expect(visibleRowRange(20000, VIEW, ROW, 200, 3)).toEqual({ start: 97, end: 108 });
  });

  it('clamps the window end at the last row', () => {
    // scrollTop near the bottom (row ~198) → end clamps to totalRows.
    const { end } = visibleRowRange(198 * ROW, VIEW, ROW, 200, 3);
    expect(end).toBe(200);
  });

  it('mounts only a bounded number of rows regardless of grid size', () => {
    const small = visibleRowRange(20000, VIEW, ROW, 200, 3);
    const huge = visibleRowRange(20000, VIEW, ROW, 100000, 3);
    expect(huge.end - huge.start).toBe(small.end - small.start); // O(1) in N
    expect(huge.end - huge.start).toBeLessThan(20);
  });
});

describe('windowWithFocus (#130 — focus invariant)', () => {
  const OVER = 3;

  it('returns the base window unchanged when the focused row is already mounted', () => {
    expect(windowWithFocus({ start: 10, end: 20 }, 15, 200, OVER)).toEqual({ start: 10, end: 20 });
  });

  it('always mounts the focused row — extends up when it sits just above', () => {
    // Focused row 8, window [10,20): extend the top to include it (with overscan).
    const win = windowWithFocus({ start: 10, end: 20 }, 8, 200, OVER);
    expect(win.start).toBeLessThanOrEqual(8);
    expect(win.end).toBe(20);
    expect(8).toBeGreaterThanOrEqual(win.start);
    expect(8).toBeLessThan(win.end);
  });

  it('always mounts the focused row — extends down when it sits just below', () => {
    const win = windowWithFocus({ start: 10, end: 20 }, 22, 200, OVER);
    expect(win.start).toBe(10);
    expect(win.end).toBeGreaterThan(22);
  });

  it('re-anchors a bounded band when the focused row is far away (large jump)', () => {
    // The C1 case: scroll is around the top [0,8) but focus jumped to row 150.
    // The result must mount row 150 WITHOUT mounting everything in between.
    const win = windowWithFocus({ start: 0, end: 8 }, 150, 200, OVER);
    expect(150).toBeGreaterThanOrEqual(win.start);
    expect(150).toBeLessThan(win.end);
    expect(win.end - win.start).toBeLessThan(2 * OVER + 2); // bounded, not O(N)
    expect(win.start).toBeGreaterThan(8); // didn't span the gap from the base window
  });

  it('clamps the anchored band at the grid edges', () => {
    expect(windowWithFocus({ start: 50, end: 60 }, 0, 200, OVER).start).toBe(0);
    const top = windowWithFocus({ start: 0, end: 8 }, 199, 200, OVER);
    expect(top.end).toBe(200);
  });

  it('is a no-op for an empty grid or out-of-range focus', () => {
    expect(windowWithFocus({ start: 0, end: 0 }, 0, 0, OVER)).toEqual({ start: 0, end: 0 });
    expect(windowWithFocus({ start: 0, end: 8 }, 999, 200, OVER)).toEqual({ start: 0, end: 8 });
  });
});

describe('scrollTopForRow (#130)', () => {
  it('leaves the scroll untouched when measurements are unavailable', () => {
    expect(scrollTopForRow(100, 0, 0, 1234, 16)).toBe(1234);
  });

  it('leaves the scroll untouched when the row is already fully visible', () => {
    // Viewport [0, 800); row 1 occupies [200, 400) — fully inside.
    expect(scrollTopForRow(1, ROW, VIEW, 0, 0)).toBe(0);
  });

  it('scrolls up (aligns the row to the top, minus pad) when it is above', () => {
    // Viewport [4000, 4800); row 10 is at [2000, 2200) — above.
    expect(scrollTopForRow(10, ROW, VIEW, 4000, 16)).toBe(10 * ROW - 16);
  });

  it('never scrolls above the top of the content', () => {
    expect(scrollTopForRow(0, ROW, VIEW, 4000, 16)).toBe(0);
  });

  it('scrolls down (aligns the row to the bottom, plus pad) when it is below', () => {
    // Viewport [0, 800); row 10 at [2000, 2200) — below.
    // target = rowBottom + pad - viewport = 2200 + 16 - 800 = 1416.
    expect(scrollTopForRow(10, ROW, VIEW, 0, 16)).toBe(1416);
  });

  it('brings a far-jumped row into view from anywhere (alphabet jump path)', () => {
    // Jump from the top to row 500 (far below): the resulting scrollTop must put
    // row 500 inside [scrollTop, scrollTop+viewport).
    const target = scrollTopForRow(500, ROW, VIEW, 0, 16);
    const rowTop = 500 * ROW;
    expect(rowTop).toBeGreaterThanOrEqual(target);
    expect(rowTop + ROW).toBeLessThanOrEqual(target + VIEW);
  });
});
