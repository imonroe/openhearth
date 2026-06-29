/**
 * Library Tile (design-system §11 "Library Tile (Portrait)"). Portrait poster
 * frame + title + year. Renders the metadata poster (#42, FR-C2) when one has
 * been resolved, falling back to a placeholder with the title's initial — both
 * occupy the same frame, so artwork loading in causes no layout shift. A poster
 * that fails to load also falls back to the placeholder.
 */
import { useState, type ReactNode } from 'react';
import { useFocus } from '../focus/FocusProvider';
import { useScrollIntoViewOnFocus } from './useScrollIntoViewOnFocus';
import { entryArtworkUrl, isShow, type LibraryEntry } from '../library/libraryModel';

export function LibraryTileView({
  entry,
  row,
  col,
  scrollOnFocus = true,
  active = true,
}: {
  entry: LibraryEntry;
  row: number;
  col: number;
  /**
   * Self-scroll into view when focused (default). The virtualized grid (#130)
   * sets this false and scrolls its container instead, so a focus jump to an
   * as-yet-unmounted row still works.
   */
  scrollOnFocus?: boolean;
  /**
   * Whether this tile's focus region is active (default true). When the grid
   * shares the screen with the A–Z rail (#131), the grid passes false while the
   * rail holds focus so the ring shows on exactly one region at a time.
   */
  active?: boolean;
}): ReactNode {
  const { isFocused, focusAt, activate } = useFocus();
  const focused = active && isFocused(row, col);
  const ref = useScrollIntoViewOnFocus<HTMLDivElement>(focused && scrollOnFocus);
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
    <div
      ref={ref}
      className={className}
      role="gridcell"
      aria-selected={focused}
      aria-label={entry.title}
      onMouseEnter={() => focusAt({ row, col })}
      onClick={() => activate({ row, col })}
    >
      <div className="tile__frame">
        {poster ? (
          <img
            className="tile__art"
            src={poster}
            alt=""
            draggable={false}
            // Off-screen posters in a long row / the full-library grid (#124)
            // shouldn't all fetch at once on a large collection.
            loading="lazy"
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
