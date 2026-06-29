/**
 * A–Z jump rail (#131): a vertical column of letters down the left edge of the
 * full-library grid. Selecting a letter jumps grid focus to the first title in
 * that section. Disabled letters (no titles) are dimmed and skipped by focus
 * navigation (their rail row has length 0).
 *
 * Each letter is a focus cell of the rail's own FocusProvider (owned by
 * LibraryGrid). `active` reflects whether the rail currently holds focus, so the
 * focus ring shows on exactly one region at a time even though both the grid and
 * rail providers stay mounted.
 */
import type { ReactNode } from 'react';
import { useFocus } from '../focus/FocusProvider';
import type { RailSection } from './railModel';

function RailLetter({
  section,
  row,
  active,
}: {
  section: RailSection;
  row: number;
  active: boolean;
}): ReactNode {
  const { isFocused, focusAt, activate } = useFocus();
  const focused = active && isFocused(row, 0);
  const className = [
    'rail__letter',
    section.enabled ? '' : 'is-disabled',
    focused ? 'is-focused' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={className}
      role="button"
      aria-label={`Jump to ${section.letter}`}
      aria-disabled={!section.enabled}
      onMouseEnter={section.enabled ? () => focusAt({ row, col: 0 }) : undefined}
      onClick={section.enabled ? () => activate({ row, col: 0 }) : undefined}
    >
      {section.letter}
    </div>
  );
}

export function Rail({
  sections,
  active,
}: {
  sections: RailSection[];
  active: boolean;
}): ReactNode {
  return (
    <div className="rail" role="navigation" aria-label="Jump to letter">
      {sections.map((section, row) => (
        <RailLetter key={section.letter} section={section} row={row} active={active} />
      ))}
    </div>
  );
}
