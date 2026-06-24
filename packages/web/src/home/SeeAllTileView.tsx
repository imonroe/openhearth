/**
 * "See all" tile (#124) — the leading tile (col 0) of a library row. Selecting
 * it opens the full-library grid overlay, so a large collection (1300+ movies)
 * is one select away instead of a long horizontal scroll. It speaks the same
 * focus vocabulary as the other tiles: hover focuses, click activates (which
 * routes through the FocusProvider's onSelect, exactly like a keyboard Select).
 *
 * It mirrors the Library Tile's footprint so the row stays aligned, but fills
 * the poster frame with a grid glyph and a "N titles" sub-line instead of art.
 */
import type { ReactNode } from 'react';
import { useFocus } from '../focus/FocusProvider';
import { useScrollIntoViewOnFocus } from './useScrollIntoViewOnFocus';

export function SeeAllTileView({
  count,
  row,
  col,
}: {
  count: number;
  row: number;
  col: number;
}): ReactNode {
  const { isFocused, focusAt, activate } = useFocus();
  const focused = isFocused(row, col);
  const ref = useScrollIntoViewOnFocus<HTMLDivElement>(focused);
  const className = ['tile', 'tile--library', 'tile--see-all', focused ? 'is-focused' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      className={className}
      role="gridcell"
      aria-selected={focused}
      aria-label={`See all ${count} titles`}
      onMouseEnter={() => focusAt({ row, col })}
      onClick={() => activate({ row, col })}
    >
      <div className="tile__frame tile--see-all__frame">
        <span className="tile--see-all__glyph" aria-hidden="true">
          ▦
        </span>
        <span className="tile--see-all__cta" aria-hidden="true">
          See all
        </span>
      </div>
      <div className="tile__info">
        <div className="tile__label">See all</div>
        <div className="tile__sub">
          {count} title{count === 1 ? '' : 's'}
        </div>
      </div>
    </div>
  );
}
