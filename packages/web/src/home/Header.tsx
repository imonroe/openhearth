/**
 * Home header (design-system §12.02): logo + wordmark, clock, focusable Search
 * and Settings actions. The header is focus row 0 so Up from the top content
 * row reaches it.
 */
import type { ReactNode } from 'react';
import { useFocus } from '../focus/FocusProvider';

const HEADER_ROW = 0;

export function Header({ title }: { title: string }): ReactNode {
  const { isFocused, focusAt, activate } = useFocus();
  return (
    <header className="header">
      <div className="header__logo">
        <div className="header__logo-mark" aria-hidden="true" />
        <span className="header__wordmark">{title.toUpperCase()}</span>
      </div>
      <div className="header__actions" role="group" aria-label="Header actions">
        <span className="header__clock">{/* clock wired in a later phase */}—:—</span>
        <button
          type="button"
          className={`header__action header__action--icon ${isFocused(HEADER_ROW, 0) ? 'is-focused' : ''}`}
          aria-label="Search"
          onMouseEnter={() => focusAt({ row: HEADER_ROW, col: 0 })}
          onClick={() => activate({ row: HEADER_ROW, col: 0 })}
        >
          ⌕
        </button>
        <button
          type="button"
          className={`header__action ${isFocused(HEADER_ROW, 1) ? 'is-focused' : ''}`}
          onMouseEnter={() => focusAt({ row: HEADER_ROW, col: 1 })}
          onClick={() => activate({ row: HEADER_ROW, col: 1 })}
        >
          ⚙ Settings
        </button>
      </div>
    </header>
  );
}
