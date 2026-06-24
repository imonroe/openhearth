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
