/**
 * Home media tile (#155) — a portrait poster tile for the Continue Watching and
 * Next Up rows. Reuses the Library Tile's frame/label styling (design-system
 * §11) and adds an optional progress bar for in-progress items. Kept separate
 * from `LibraryTileView` because these rows render a single item (an episode or
 * movie) with a season/episode sub-label, not an aggregated show group.
 */
import { useState, type ReactNode } from 'react';
import type { LibraryItem } from '@openhearth/shared';
import { useFocus } from '../focus/FocusProvider';
import { useScrollIntoViewOnFocus } from './useScrollIntoViewOnFocus';

/** Sub-label for a media item: "S2 · E3 · Title" for an episode, else the year. */
export function mediaSubLabel(item: LibraryItem): string {
  if (item.kind === 'episode') {
    const season = item.season ?? 1;
    const se = item.episode != null ? `S${season} · E${item.episode}` : `S${season}`;
    return item.episode_title ? `${se} · ${item.episode_title}` : se;
  }
  return item.year != null ? String(item.year) : '';
}

export function HomeMediaTile({
  row,
  col,
  title,
  sub,
  artworkUrl,
  progress,
}: {
  row: number;
  col: number;
  title: string;
  sub?: string;
  artworkUrl?: string | null;
  /** Fraction watched (0–1) for an in-progress item; omit/null for no bar. */
  progress?: number | null;
}): ReactNode {
  const { isFocused, focusAt, activate } = useFocus();
  const focused = isFocused(row, col);
  const ref = useScrollIntoViewOnFocus<HTMLDivElement>(focused);
  const [failed, setFailed] = useState(false);
  const poster = failed ? undefined : (artworkUrl ?? undefined);
  const className = ['tile', 'tile--library', focused ? 'is-focused' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      className={className}
      role="gridcell"
      aria-selected={focused}
      aria-label={title}
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
            loading="lazy"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="tile__placeholder" aria-hidden="true">
            {title.charAt(0).toUpperCase()}
          </span>
        )}
        {progress != null ? (
          <div className="tile__progress" aria-hidden="true">
            <div
              className="tile__progress-fill"
              style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }}
            />
          </div>
        ) : null}
      </div>
      <div className="tile__info">
        <div className="tile__label">{title}</div>
        {sub ? <div className="tile__sub">{sub}</div> : null}
      </div>
    </div>
  );
}
