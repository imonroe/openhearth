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

// A–Z jump rail (#131). Buckets: A×4 (idx 0-3), B×2 (idx 4-5, B starts mid-row),
// C×6 (idx 6-11), M×2 (idx 12-13). Letters D–L, N–Z are empty (disabled).
describe('LibraryGrid A–Z rail (#131)', () => {
  const railEntries = buildLibraryEntries(
    [
      ...['A1', 'A2', 'A3', 'A4'],
      ...['B1', 'B2'],
      ...['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
      ...['M1', 'M2'],
    ].map((t) => movie(t, t)),
  );

  function renderRail() {
    const onOpen = vi.fn();
    render(
      <LibraryGrid
        label="Movies"
        entries={railEntries}
        keyMap={keyMap}
        onBack={vi.fn()}
        onOpen={onOpen}
      />,
    );
    return { onOpen };
  }
  const railLetter = (l: string) => screen.getByLabelText(`Jump to ${l}`);
  const isFocused = (el: Element | null) => !!el?.classList.contains('is-focused');

  it('renders A–Z, disabling empty letters', () => {
    renderRail();
    expect(railLetter('A').getAttribute('aria-disabled')).toBe('false');
    expect(railLetter('D').getAttribute('aria-disabled')).toBe('true');
    expect(railLetter('D').classList.contains('is-disabled')).toBe(true);
  });

  it('crosses into the rail with Left, landing on the current section', () => {
    renderRail();
    // Focus starts on A1 (section A). Left from col 0 enters the rail at "A".
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(isFocused(railLetter('A'))).toBe(true);
    // The grid tile no longer shows the ring (one focused region at a time).
    expect(isFocused(screen.getByLabelText('A1'))).toBe(false);
  });

  it('navigates the rail skipping disabled letters and jumps on Select', () => {
    renderRail();
    fireEvent.keyDown(window, { key: 'ArrowLeft' }); // → rail at A
    fireEvent.keyDown(window, { key: 'ArrowDown' }); // B
    expect(isFocused(railLetter('B'))).toBe(true);
    fireEvent.keyDown(window, { key: 'ArrowDown' }); // C
    fireEvent.keyDown(window, { key: 'ArrowDown' }); // skips D–L → M
    expect(isFocused(railLetter('M'))).toBe(true);
    // Select jumps grid focus to the first M title and returns to the grid.
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(isFocused(screen.getByLabelText('M1'))).toBe(true);
    expect(isFocused(railLetter('M'))).toBe(false);
  });

  it('jumps to the exact first title of a section that starts mid-row', () => {
    renderRail();
    // B's first title is at index 4 (row 0, col 4) — a mid-row section start.
    fireEvent.keyDown(window, { key: 'b' }); // type-to-jump
    expect(isFocused(screen.getByLabelText('B1'))).toBe(true);
  });

  it('type-to-jump moves straight to a letter from the grid', () => {
    renderRail();
    fireEvent.keyDown(window, { key: 'c' });
    expect(isFocused(screen.getByLabelText('C1'))).toBe(true);
  });

  it('ignores a typed letter with no titles', () => {
    renderRail();
    // Focus starts on A1; pressing a disabled letter does nothing.
    fireEvent.keyDown(window, { key: 'd' });
    expect(isFocused(screen.getByLabelText('A1'))).toBe(true);
  });

  it('jumps on a rail letter click (mouse parity)', () => {
    renderRail();
    fireEvent.click(railLetter('C'));
    expect(isFocused(screen.getByLabelText('C1'))).toBe(true);
  });

  it('Back from the rail returns to the grid without jumping', () => {
    renderRail();
    fireEvent.keyDown(window, { key: 'ArrowLeft' }); // → rail
    expect(isFocused(railLetter('A'))).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' }); // back → grid
    expect(isFocused(screen.getByLabelText('A1'))).toBe(true); // grid focus restored
    expect(isFocused(railLetter('A'))).toBe(false);
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
