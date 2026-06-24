/**
 * Focus-navigation latency benchmark (#51, NFR-2 "focus nav ~100ms").
 *
 * NFR-2's budget covers the whole keydown → focus-move → re-render path. The
 * pure decision (`move`) is the only part that scales with grid size, so this
 * pins its cost: it must be a vanishingly small fraction of the 100ms budget
 * even on a large grid, leaving essentially all of the budget for React's render.
 * Reproducible — `pnpm --filter @openhearth/web test focusEngine.bench` prints the
 * measured per-move time; the assertion is a generous regression guard, not a
 * tight timing (so it isn't flaky on a loaded CI box).
 */
import { describe, it, expect } from 'vitest';
import { move, firstFocusable, type Direction } from './focusEngine';

describe('focus-nav latency (NFR-2)', () => {
  it('a move on a large grid is far under the 100ms budget', () => {
    // A grid much larger than any real OpenHearth screen: 200 rows × ~30 tiles.
    const rowLengths = Array.from({ length: 200 }, (_, r) => 10 + (r % 30));
    const dirs: Direction[] = ['down', 'right', 'up', 'left'];
    const ITER = 100_000;

    let pos = firstFocusable(rowLengths) ?? { row: 0, col: 0 };
    const start = performance.now();
    for (let i = 0; i < ITER; i++) {
      pos = move(rowLengths, pos, dirs[i % dirs.length] as Direction);
    }
    const perMoveMs = (performance.now() - start) / ITER;

    // Per-move cost is microseconds; assert it's < 0.5ms (≈0.5% of the 100ms
    // budget) with huge slack for a busy CI runner. `pos` is used so the loop
    // can't be optimized away.
    expect(pos).toBeDefined();
    expect(perMoveMs).toBeLessThan(0.5);
    // Surfaced in the test output for the performance record (docs/performance.md).
    console.log(`focus move(): ${(perMoveMs * 1000).toFixed(2)} µs/move over ${ITER} moves`);
  });
});
