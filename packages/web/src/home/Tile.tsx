/**
 * Placeholder Service / Library tile (design-system §11). Empty artwork frame
 * until the catalog/library land (#23/#31); the focus highlight is the point of
 * this scaffold.
 */
import type { ReactNode } from 'react';
import { useFocus } from '../focus/FocusProvider';

interface TileProps {
  kind: 'services' | 'library';
  row: number;
  col: number;
  /** Optional placeholder label; tiles are otherwise empty at this stage. */
  label?: string;
}

export function Tile({ kind, row, col, label }: TileProps): ReactNode {
  const { isFocused } = useFocus();
  const focused = isFocused(row, col);
  const className = [
    'tile',
    kind === 'services' ? 'tile--service' : 'tile--library',
    focused ? 'is-focused' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      data-focused={focused || undefined}
      role="gridcell"
      aria-selected={focused}
    >
      <div className="tile__frame" />
      {label ? <div className="tile__label">{label}</div> : null}
    </div>
  );
}
