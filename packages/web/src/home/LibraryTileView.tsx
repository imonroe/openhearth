/**
 * Library Tile (design-system §11 "Library Tile (Portrait)"). Portrait poster
 * frame + title + year. Renders the metadata poster (#42, FR-C2) when one has
 * been resolved, falling back to a placeholder with the title's initial — both
 * occupy the same frame, so artwork loading in causes no layout shift. A poster
 * that fails to load also falls back to the placeholder.
 */
import { useState, type ReactNode } from 'react';
import { useFocus } from '../focus/FocusProvider';
import { entryArtworkUrl, isShow, type LibraryEntry } from '../library/libraryModel';

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
  const [failed, setFailed] = useState(false);
  const className = ['tile', 'tile--library', focused ? 'is-focused' : '']
    .filter(Boolean)
    .join(' ');
  const year = entry.year ?? undefined;
  const sub = isShow(entry)
    ? `${entry.seasons.length} season${entry.seasons.length === 1 ? '' : 's'}`
    : year != null
      ? String(year)
      : '';
  const poster = failed ? undefined : entryArtworkUrl(entry);

  return (
    <div className={className} role="gridcell" aria-selected={focused} aria-label={entry.title}>
      <div className="tile__frame">
        {poster ? (
          <img
            className="tile__art"
            src={poster}
            alt=""
            draggable={false}
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="tile__placeholder" aria-hidden="true">
            {entry.title.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div className="tile__info">
        <div className="tile__label">{entry.title}</div>
        {sub ? <div className="tile__sub">{sub}</div> : null}
      </div>
    </div>
  );
}
