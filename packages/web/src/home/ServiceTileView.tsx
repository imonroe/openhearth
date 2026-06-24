/**
 * Service tile (design-system §11 Service Tile). Renders the service artwork
 * (remote URL or local config file) with a graceful placeholder fallback when
 * the icon is missing or fails to load (FR-A6). The label is the service name,
 * turning amber when focused.
 */
import { useState, type ReactNode } from 'react';
import type { ServiceTile } from '@openhearth/shared';
import { serviceIconUrl } from '../api';
import { useFocus } from '../focus/FocusProvider';

export function ServiceTileView({
  tile,
  row,
  col,
}: {
  tile: ServiceTile;
  row: number;
  col: number;
}): ReactNode {
  const { isFocused, focusAt, activate } = useFocus();
  const focused = isFocused(row, col);
  const [failed, setFailed] = useState(false);

  const src = failed ? null : serviceIconUrl(tile.id, tile.icon);
  const className = ['tile', 'tile--service', focused ? 'is-focused' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      role="gridcell"
      aria-selected={focused}
      onMouseEnter={() => focusAt({ row, col })}
      onClick={() => activate({ row, col })}
    >
      <div className="tile__frame">
        {src ? (
          <img
            className="tile__art"
            src={src}
            alt=""
            draggable={false}
            onError={() => setFailed(true)}
          />
        ) : (
          // Placeholder: the service's initial on the tile background.
          <span className="tile__placeholder" aria-hidden="true">
            {tile.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div className="tile__label">{tile.name}</div>
    </div>
  );
}
