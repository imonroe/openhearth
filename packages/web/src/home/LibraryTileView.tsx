/**
 * Library Tile (design-system §11 "Library Tile (Portrait)"). Portrait poster
 * frame + title + year. Artwork isn't available yet (metadata is Phase 4), so we
 * render a placeholder poster with the title's initial; the structure and focus
 * ring match the spec so artwork can drop in later without layout change.
 */
import type { ReactNode } from 'react';
import { useFocus } from '../focus/FocusProvider';
import { isShow, type LibraryEntry } from '../library/libraryModel';

export function LibraryTileView({
  entry,
  row,
  col,
}: {
  entry: LibraryEntry;
  row: number;
  col: number;
}): ReactNode {
  const { isFocused } = useFocus();
  const focused = isFocused(row, col);
  const className = ['tile', 'tile--library', focused ? 'is-focused' : '']
    .filter(Boolean)
    .join(' ');
  const year = entry.year ?? undefined;
  const sub = isShow(entry)
    ? `${entry.seasons.length} season${entry.seasons.length === 1 ? '' : 's'}`
    : year != null
      ? String(year)
      : '';

  return (
    <div className={className} role="gridcell" aria-selected={focused} aria-label={entry.title}>
      <div className="tile__frame">
        <span className="tile__placeholder" aria-hidden="true">
          {entry.title.charAt(0).toUpperCase()}
        </span>
      </div>
      <div className="tile__info">
        <div className="tile__label">{entry.title}</div>
        {sub ? <div className="tile__sub">{sub}</div> : null}
      </div>
    </div>
  );
}
