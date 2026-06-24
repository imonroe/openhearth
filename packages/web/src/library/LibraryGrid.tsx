/**
 * Full-library grid overlay (#124). A scrollable, alphabetical grid of every
 * item in one library source — the answer to "scrolling 1300 movies on a single
 * row is bad UX". It runs under its own FocusProvider, modelling the grid as a
 * fixed-column matrix so Up/Down move a whole row at a time and Left/Right move
 * within it (the focus engine clamps at the edges; focus never disappears).
 *
 * Selecting a tile opens that entry's detail (the same path as the home row);
 * Back closes the overlay and returns to home. Mouse works too: hover focuses,
 * click activates — identical to focusing then pressing Select.
 *
 * Tiles reuse {@link LibraryTileView}, so artwork, placeholders, focus scaling
 * and scroll-into-view behave exactly as on the home screen. The column count is
 * a single constant shared with the CSS (via a custom property) so the visual
 * grid and the focus matrix can never drift apart.
 */
import { useCallback, type ReactNode } from 'react';
import type { CSSProperties } from 'react';
import { FocusProvider } from '../focus/FocusProvider';
import type { FocusPosition } from '../focus/focusEngine';
import type { KeyMap } from '../keybindings';
import { LibraryTileView } from '../home/LibraryTileView';
import { entryId, type LibraryEntry } from './libraryModel';

/** Grid width. Shared with the CSS via the `--grid-cols` custom property below. */
export const GRID_COLUMNS = 6;

/** Per-row focusable counts for an N-item grid `COLUMNS` wide (last row partial). */
export function gridRowLengths(itemCount: number, columns: number): number[] {
  if (itemCount <= 0) return [0];
  const fullRows = Math.floor(itemCount / columns);
  const remainder = itemCount % columns;
  const lengths = new Array<number>(fullRows).fill(columns);
  if (remainder > 0) lengths.push(remainder);
  return lengths;
}

export function LibraryGrid({
  label,
  entries,
  keyMap,
  onBack,
  onOpen,
}: {
  label: string;
  entries: LibraryEntry[];
  keyMap: KeyMap;
  onBack: () => void;
  onOpen: (entry: LibraryEntry) => void;
}): ReactNode {
  const rowLengths = gridRowLengths(entries.length, GRID_COLUMNS);

  const onSelect = useCallback(
    (pos: FocusPosition) => {
      const index = pos.row * GRID_COLUMNS + pos.col;
      const entry = entries[index];
      if (entry) onOpen(entry);
    },
    [entries, onOpen],
  );

  return (
    <FocusProvider
      rowLengths={rowLengths}
      initialPosition={{ row: 0, col: 0 }}
      keyMap={keyMap}
      onSelect={onSelect}
      onBack={onBack}
    >
      <div className="library-grid" role="region" aria-label={`All ${label}`}>
        <div className="library-grid__head">
          <button type="button" className="detail__back" onClick={onBack}>
            ← Back
          </button>
          <h1 className="library-grid__title">{label}</h1>
          <span className="library-grid__count">
            {entries.length} title{entries.length === 1 ? '' : 's'}
          </span>
        </div>
        <div
          className="library-grid__scroll"
          role="grid"
          aria-label={`${label} — ${entries.length} titles`}
        >
          <div
            className="library-grid__grid"
            style={{ '--grid-cols': GRID_COLUMNS } as CSSProperties}
          >
            {entries.map((entry, index) => (
              <LibraryTileView
                key={entryId(entry)}
                entry={entry}
                row={Math.floor(index / GRID_COLUMNS)}
                col={index % GRID_COLUMNS}
              />
            ))}
          </div>
        </div>
      </div>
    </FocusProvider>
  );
}
