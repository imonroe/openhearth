/**
 * Pure windowing math for the virtualized full-library grid (#130).
 *
 * The grid can hold thousands of tiles; mounting them all is O(N) DOM nodes and
 * hurts scroll/memory on the low-power HTPC hardware OpenHearth targets. These
 * helpers compute *which contiguous range of grid rows* needs to be mounted for
 * a given scroll position, and *where to scroll* so the focused row is visible.
 *
 * They are framework-free and measurement-free so they unit-test without a DOM.
 * The React layer (LibraryGrid) measures row pitch + viewport height and feeds
 * them in. When measurements aren't available yet (first paint, or jsdom), the
 * caller renders an unwindowed fallback — see {@link visibleRowRange}.
 */

/** A half-open range of grid rows `[start, end)` to mount. */
export interface RowWindow {
  start: number;
  end: number;
}

/**
 * The contiguous row range to mount for a scroll position, padded by `overscan`
 * rows on each side so a small scroll/focus step never reveals a blank gap.
 *
 * Degrades safely: with no usable measurements (`rowHeight <= 0` or
 * `viewportHeight <= 0`) it returns the whole grid `[0, totalRows)`, so the
 * caller renders everything rather than nothing — correctness over performance.
 */
export function visibleRowRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  totalRows: number,
  overscan: number,
): RowWindow {
  if (totalRows <= 0) return { start: 0, end: 0 };
  if (rowHeight <= 0 || viewportHeight <= 0) return { start: 0, end: totalRows };

  const firstVisible = Math.floor(scrollTop / rowHeight);
  const visibleRows = Math.ceil(viewportHeight / rowHeight) + 1;
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(totalRows, firstVisible + visibleRows + overscan);
  return { start, end };
}

/**
 * Guarantee the focused row is inside the mounted window — the focus invariant
 * (design-system §9: one focused element at all times, focus never disappears)
 * must hold regardless of scroll timing. A smooth focus-scroll animates the
 * container over several frames, and each frame's `onScroll` recomputes the
 * scroll-derived window; without this, the focused destination row would be
 * unmounted (blank focus) until the animation arrives.
 *
 * If the focused row is already mounted, the base window is returned unchanged.
 * If it sits just outside, the window is extended to reach it. If it's far
 * outside (a large jump still settling), the window is *re-anchored* on the
 * focused row as a bounded band rather than mounting every row in between — so
 * the node count stays bounded even mid-jump.
 */
export function windowWithFocus(
  base: RowWindow,
  focusedRow: number,
  totalRows: number,
  overscan: number,
): RowWindow {
  if (totalRows <= 0) return { start: 0, end: 0 };
  const { start, end } = base;
  if (focusedRow < 0 || focusedRow >= totalRows) return { start, end };
  if (focusedRow >= start && focusedRow < end) return { start, end }; // already mounted

  // "Close enough" to bridge by extending the window rather than re-anchoring.
  const near = overscan * 2;
  if (focusedRow < start && start - focusedRow <= near) {
    return { start: Math.max(0, focusedRow - overscan), end };
  }
  if (focusedRow >= end && focusedRow - end < near) {
    return { start, end: Math.min(totalRows, focusedRow + overscan + 1) };
  }
  // Far away: anchor a bounded band on the focused row.
  return {
    start: Math.max(0, focusedRow - overscan),
    end: Math.min(totalRows, focusedRow + overscan + 1),
  };
}

/**
 * The `scrollTop` that brings grid `row` just into view — `block: 'nearest'`
 * semantics: scroll up if the row sits above the viewport, down if it sits
 * below, otherwise leave the scroll position untouched. `pad` keeps a little
 * margin so the amber focus-ring glow isn't clipped at the viewport edge.
 *
 * Crucially this is computed from the row index and pitch alone, so it works
 * even when the target tile is not currently mounted — which is what lets focus
 * jump to an off-screen row (arrow paging, or the #131 alphabet jump) and pull
 * the window to it, rather than relying on the element's own scrollIntoView.
 */
export function scrollTopForRow(
  row: number,
  rowHeight: number,
  viewportHeight: number,
  scrollTop: number,
  pad: number,
): number {
  if (rowHeight <= 0 || viewportHeight <= 0) return scrollTop;

  const rowTop = row * rowHeight;
  const rowBottom = rowTop + rowHeight;
  if (rowTop - pad < scrollTop) {
    return Math.max(0, rowTop - pad); // above the viewport → align to its top
  }
  if (rowBottom + pad > scrollTop + viewportHeight) {
    return rowBottom + pad - viewportHeight; // below the viewport → align to its bottom
  }
  return scrollTop; // already fully visible
}
