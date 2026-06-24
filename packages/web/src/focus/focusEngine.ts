/**
 * Focus engine — pure directional-navigation primitives.
 *
 * The home screen is modeled as a grid of rows, each with a number of focusable
 * items (`rowLengths`). Focus is a single `{ row, col }` position — there is
 * always exactly one focused element (design-system §9 rule 1). Movement is
 * clamped at the edges (focus never disappears). Up/Down preserve the column
 * where possible, clamped to the destination row's length.
 *
 * This is intentionally framework-free so it can be unit-tested without a DOM.
 * The React layer (FocusProvider) wraps it; key→direction mapping lives in
 * keybindings.ts.
 */
export type Direction = 'up' | 'down' | 'left' | 'right';

export interface FocusPosition {
  row: number;
  col: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/** Number of focusable items in a row, treating empties defensively. */
function rowLen(rowLengths: number[], row: number): number {
  return Math.max(0, rowLengths[row] ?? 0);
}

/**
 * Compute the next focus position given the grid shape, current position, and a
 * direction. Rows with zero items are skipped when moving vertically so focus
 * never lands on an empty row. Returns the same position if movement is blocked.
 */
export function move(rowLengths: number[], pos: FocusPosition, dir: Direction): FocusPosition {
  const rows = rowLengths.length;
  if (rows === 0) return pos;

  if (dir === 'left' || dir === 'right') {
    const len = rowLen(rowLengths, pos.row);
    if (len === 0) return pos;
    const delta = dir === 'right' ? 1 : -1;
    return { row: pos.row, col: clamp(pos.col + delta, 0, len - 1) };
  }

  // Vertical: find the next non-empty row in the given direction.
  const delta = dir === 'down' ? 1 : -1;
  let nextRow = pos.row + delta;
  while (nextRow >= 0 && nextRow < rows && rowLen(rowLengths, nextRow) === 0) {
    nextRow += delta;
  }
  if (nextRow < 0 || nextRow >= rows || rowLen(rowLengths, nextRow) === 0) {
    return pos; // edge, or no non-empty row that way
  }
  const len = rowLen(rowLengths, nextRow);
  return { row: nextRow, col: clamp(pos.col, 0, len - 1) };
}

/** The first focusable position (first non-empty row, col 0), or null if none. */
export function firstFocusable(rowLengths: number[]): FocusPosition | null {
  for (let row = 0; row < rowLengths.length; row++) {
    if (rowLen(rowLengths, row) > 0) return { row, col: 0 };
  }
  return null;
}
