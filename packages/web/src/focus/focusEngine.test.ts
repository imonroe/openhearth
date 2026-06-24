import { describe, it, expect } from 'vitest';
import { move, firstFocusable } from './focusEngine';

describe('focusEngine.move', () => {
  const grid = [2, 5, 5]; // header(2), movies(5), tv(5)

  it('moves right within a row, clamped at the end', () => {
    expect(move(grid, { row: 1, col: 0 }, 'right')).toEqual({ row: 1, col: 1 });
    expect(move(grid, { row: 1, col: 4 }, 'right')).toEqual({ row: 1, col: 4 });
  });

  it('moves left within a row, clamped at the start', () => {
    expect(move(grid, { row: 1, col: 2 }, 'left')).toEqual({ row: 1, col: 1 });
    expect(move(grid, { row: 1, col: 0 }, 'left')).toEqual({ row: 1, col: 0 });
  });

  it('moves between rows and clamps the column to the destination length', () => {
    expect(move(grid, { row: 1, col: 4 }, 'up')).toEqual({ row: 0, col: 1 }); // header has 2
    expect(move(grid, { row: 0, col: 1 }, 'down')).toEqual({ row: 1, col: 1 });
  });

  it('does not move past the top or bottom edge', () => {
    expect(move(grid, { row: 0, col: 0 }, 'up')).toEqual({ row: 0, col: 0 });
    expect(move(grid, { row: 2, col: 0 }, 'down')).toEqual({ row: 2, col: 0 });
  });

  it('skips empty rows when moving vertically', () => {
    const withEmpty = [2, 0, 4]; // middle row has no focusable items
    expect(move(withEmpty, { row: 0, col: 0 }, 'down')).toEqual({ row: 2, col: 0 });
    expect(move(withEmpty, { row: 2, col: 3 }, 'up')).toEqual({ row: 0, col: 1 });
  });

  it('is a no-op on an empty grid', () => {
    expect(move([], { row: 0, col: 0 }, 'down')).toEqual({ row: 0, col: 0 });
  });
});

describe('focusEngine.firstFocusable', () => {
  it('returns the first non-empty row at col 0', () => {
    expect(firstFocusable([0, 0, 3])).toEqual({ row: 2, col: 0 });
  });
  it('returns null when nothing is focusable', () => {
    expect(firstFocusable([0, 0])).toBeNull();
  });
});
