import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { LibraryItem } from '@openhearth/shared';
import { LibraryGrid, gridRowLengths, GRID_COLUMNS } from './LibraryGrid';
import { buildLibraryEntries } from './libraryModel';
import { buildKeyMap } from '../keybindings';

const keyMap = buildKeyMap();

function movie(title: string, id: string): LibraryItem {
  return {
    id,
    source_id: 'movies',
    kind: 'movie',
    path: `/m/${id}.mkv`,
    title,
    mtime: 1,
    indexed_at: 1,
  };
}

// Two full rows + a partial third (for GRID_COLUMNS = 6 → 6, 6, 1).
const entries = buildLibraryEntries(
  Array.from({ length: 13 }, (_, i) => movie(`Title ${String(i).padStart(2, '0')}`, `m${i}`)),
);

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe('gridRowLengths', () => {
  it('splits N items into rows of `columns`, last row partial', () => {
    expect(gridRowLengths(13, 6)).toEqual([6, 6, 1]);
    expect(gridRowLengths(12, 6)).toEqual([6, 6]);
    expect(gridRowLengths(1, 6)).toEqual([1]);
  });

  it('returns a single empty row for an empty grid (focus invariant)', () => {
    expect(gridRowLengths(0, 6)).toEqual([0]);
  });
});

describe('LibraryGrid', () => {
  it('renders every entry as a tile, alphabetically', () => {
    render(
      <LibraryGrid
        label="Movies"
        entries={entries}
        keyMap={keyMap}
        onBack={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('13 titles')).toBeTruthy();
    expect(screen.getAllByRole('gridcell')).toHaveLength(13);
    // Focus enters on the first tile.
    expect(screen.getByLabelText('Title 00').classList.contains('is-focused')).toBe(true);
  });

  it('moves focus down a whole row and selects the entry under focus', () => {
    const onOpen = vi.fn();
    render(
      <LibraryGrid
        label="Movies"
        entries={entries}
        keyMap={keyMap}
        onBack={vi.fn()}
        onOpen={onOpen}
      />,
    );
    // Down moves one grid row (GRID_COLUMNS tiles forward), not one tile.
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(screen.getByLabelText(`Title 0${GRID_COLUMNS}`).classList.contains('is-focused')).toBe(
      true,
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith(entries[GRID_COLUMNS]);
  });

  it('selects a tile on click (mouse parity)', () => {
    const onOpen = vi.fn();
    render(
      <LibraryGrid
        label="Movies"
        entries={entries}
        keyMap={keyMap}
        onBack={vi.fn()}
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByLabelText('Title 03'));
    expect(onOpen).toHaveBeenCalledWith(entries[3]);
  });

  it('calls onBack on the reserved Back key and the Back button', () => {
    const onBack = vi.fn();
    render(
      <LibraryGrid
        label="Movies"
        entries={entries}
        keyMap={keyMap}
        onBack={onBack}
        onOpen={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' }); // reserved back
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('← Back'));
    expect(onBack).toHaveBeenCalledTimes(2);
  });
});

// Virtualization (#130). jsdom reports no layout, so we feed fake metrics
// (viewport 800px, tile 180px + 20px gap → 200px pitch) to drive the measured,
// windowed path and assert only a bounded slice of rows is mounted.
describe('LibraryGrid virtualization (#130)', () => {
  const big = buildLibraryEntries(
    Array.from({ length: 300 }, (_, i) => movie(`Title ${String(i).padStart(3, '0')}`, `m${i}`)),
  );
  const ROWS = 300 / GRID_COLUMNS; // 50 rows
  let clientH: PropertyDescriptor | undefined;
  let offsetH: PropertyDescriptor | undefined;

  beforeEach(() => {
    clientH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    offsetH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 800,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 180,
    });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ rowGap: '20px' } as CSSStyleDeclaration);
    // ResizeObserver isn't in jsdom; a no-op stub lets the observe path run.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    if (clientH) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientH);
    if (offsetH) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetH);
    vi.unstubAllGlobals();
  });

  it('mounts only a bounded window of tiles, not all 300, and reserves full scroll height', () => {
    const { container } = render(
      <LibraryGrid
        label="Movies"
        entries={big}
        keyMap={keyMap}
        onBack={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    const cells = screen.getAllByRole('gridcell');
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThan(100); // a window, not O(N) = 300
    // The top of the list is mounted; a far-down title is not.
    expect(screen.getByLabelText('Title 000')).toBeTruthy();
    expect(screen.queryByLabelText('Title 290')).toBeNull();
    // The sizer reserves the full height: 50 rows × 200px pitch − 20px gap = 9980px.
    const sizer = container.querySelector('.library-grid__sizer') as HTMLElement;
    expect(sizer.style.height).toBe(`${ROWS * 200 - 20}px`);
    // The window is offset to its true position (row 0 → translateY 0 here).
    expect(container.querySelector('.library-grid__grid')?.classList.contains('is-virtual')).toBe(
      true,
    );
  });

  it('recycles tiles as focus pages down: a far row mounts, an early row unmounts', () => {
    render(
      <LibraryGrid
        label="Movies"
        entries={big}
        keyMap={keyMap}
        onBack={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    // Page focus down well past the initial viewport (each ArrowDown = one row).
    for (let i = 0; i < 40; i++) fireEvent.keyDown(window, { key: 'ArrowDown' });
    // Row 40 (index 240) is now in view and mounted; the top rows are recycled out.
    expect(screen.getByLabelText('Title 240').classList.contains('is-focused')).toBe(true);
    expect(screen.queryByLabelText('Title 000')).toBeNull();
  });
});
