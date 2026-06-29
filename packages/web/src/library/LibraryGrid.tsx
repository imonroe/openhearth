/**
 * Full-library grid overlay (#124), virtualized for large collections (#130).
 *
 * A scrollable, alphabetical grid of every item in one library source — the
 * answer to "scrolling 1300 movies on a single row is bad UX". It runs under its
 * own FocusProvider, modelling the grid as a fixed-column matrix so Up/Down move
 * a whole row at a time and Left/Right move within it (the focus engine clamps
 * at the edges; focus never disappears).
 *
 * Virtualization (#130): only the rows near the viewport are mounted, recycled
 * as the user scrolls, so the DOM node count stays bounded instead of O(N). The
 * focus engine is unaffected — it navigates the abstract `rowLengths` matrix, so
 * `{row, col}` stays correct even for rows that aren't mounted. Two things keep
 * the illusion seamless: a full-height sizer preserves the scrollbar/range, and
 * the focused row is scrolled into view by moving the *container* (not the tile),
 * computed from the row index alone — so focus can land on an as-yet-unmounted
 * row (arrow paging, and the #131 alphabet jump) and pull the window to it.
 *
 * When row metrics aren't measurable yet (first paint, or jsdom under test) it
 * renders an unwindowed fallback and the tiles self-scroll, exactly as before —
 * correctness over performance.
 *
 * Selecting a tile opens that entry's detail (the same path as the home row);
 * Back closes the overlay and returns to home. Mouse works too: hover focuses,
 * click activates — identical to focusing then pressing Select.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { FocusProvider } from '../focus/FocusProvider';
import type { FocusPosition } from '../focus/focusEngine';
import type { KeyMap } from '../keybindings';
import { LibraryTileView } from '../home/LibraryTileView';
import { entryId, type LibraryEntry } from './libraryModel';
import { visibleRowRange, windowWithFocus, scrollTopForRow } from './gridWindow';

/** Grid width. Shared with the CSS via the `--grid-cols` custom property below. */
export const GRID_COLUMNS = 6;

/** Rows mounted beyond the viewport on each side, so a step never shows a gap. */
const OVERSCAN_ROWS = 3;

/**
 * Rows rendered before measurement is available (first paint / jsdom). Generous
 * enough to fill any first viewport and to let measurement see real tiles; for a
 * large library this renders briefly, then the measured window takes over.
 */
const INITIAL_ROWS = 24;

/** Margin kept around a row scrolled into view so the focus-ring glow isn't clipped. */
const FOCUS_SCROLL_PAD = 28;

/** Per-row focusable counts for an N-item grid `COLUMNS` wide (last row partial). */
export function gridRowLengths(itemCount: number, columns: number): number[] {
  if (itemCount <= 0) return [0];
  const fullRows = Math.floor(itemCount / columns);
  const remainder = itemCount % columns;
  const lengths = new Array<number>(fullRows).fill(columns);
  if (remainder > 0) lengths.push(remainder);
  return lengths;
}

interface RowMetrics {
  /** Row pitch in px (tile height + row gap), or 0 when not yet measured. */
  pitch: number;
  /** Scroll viewport height in px, or 0 when not yet measured. */
  viewport: number;
  /** Row gap in px (for trimming the trailing sizer space). */
  gap: number;
}

const NO_METRICS: RowMetrics = { pitch: 0, viewport: 0, gap: 0 };

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
  const totalRows = rowLengths.length;

  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<RowMetrics>(NO_METRICS);
  const [scrollTop, setScrollTop] = useState(0);
  const [focusedRow, setFocusedRow] = useState(0);

  const measured = metrics.pitch > 0 && metrics.viewport > 0;

  // Measure row pitch + viewport from the live DOM, re-measuring on resize (a
  // window resize changes rem-based tile sizes too). Equality-guarded so it can't
  // loop. ResizeObserver is absent in jsdom — fall back to a one-shot measure.
  useLayoutEffect(() => {
    const measure = (): void => {
      const sc = scrollRef.current;
      const grid = gridRef.current;
      if (!sc || !grid) return;
      // Measure an *unfocused* tile: the focused library tile scales up
      // (.tile--library.is-focused), so measuring it would inflate the pitch and
      // drift every row's position over a large library.
      const tile =
        grid.querySelector<HTMLElement>('.tile:not(.is-focused)') ??
        grid.querySelector<HTMLElement>('.tile');
      const gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
      const pitch = tile ? tile.offsetHeight + gap : 0;
      const viewport = sc.clientHeight;
      setMetrics((prev) =>
        prev.pitch === pitch && prev.viewport === viewport && prev.gap === gap
          ? prev
          : { pitch, viewport, gap },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined' || !scrollRef.current) return;
    const ro = new ResizeObserver(measure);
    ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, []);

  // Track scroll position (coalesced to one update per frame) to derive the window.
  const rafRef = useRef<number | null>(null);
  const onScroll = useCallback(() => {
    if (rafRef.current != null) return;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
    const apply = (): void => {
      rafRef.current = null;
      if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
    };
    if (raf) rafRef.current = raf(apply);
    else apply();
  }, []);
  useEffect(
    () => () => {
      if (rafRef.current != null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafRef.current);
      }
    },
    [],
  );

  // Keep the focused row scrolled into view by moving the container — works even
  // when the target row isn't mounted yet. No-ops until measured (the tiles
  // self-scroll then). Layout effect so the window follows in the same paint.
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (!sc || !measured) return;
    const target = scrollTopForRow(
      focusedRow,
      metrics.pitch,
      metrics.viewport,
      sc.scrollTop,
      FOCUS_SCROLL_PAD,
    );
    if (Math.abs(target - sc.scrollTop) < 1) return; // already there (sub-pixel tolerant)
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    // Jump instantly when the move is larger than the overscan band (e.g. an
    // alphabet jump): a smooth animation would scroll through rows that aren't
    // mounted, flashing blank. Small steps stay smooth.
    const farJump = Math.abs(target - sc.scrollTop) > OVERSCAN_ROWS * metrics.pitch;
    const behavior: ScrollBehavior = reduced || farJump ? 'auto' : 'smooth';
    if (typeof sc.scrollTo === 'function') {
      sc.scrollTo({ top: target, behavior });
    } else {
      sc.scrollTop = target;
    }
    setScrollTop(target); // mount the destination window now, don't wait for onScroll
  }, [focusedRow, measured, metrics.pitch, metrics.viewport]);

  const onSelect = useCallback(
    (pos: FocusPosition) => {
      const index = pos.row * GRID_COLUMNS + pos.col;
      const entry = entries[index];
      if (entry) onOpen(entry);
    },
    [entries, onOpen],
  );

  // Window = the rows near the scroll position, then force-include the focused
  // row so it can never be unmounted (focus invariant), even mid-scroll.
  const win = measured
    ? windowWithFocus(
        visibleRowRange(scrollTop, metrics.viewport, metrics.pitch, totalRows, OVERSCAN_ROWS),
        focusedRow,
        totalRows,
        OVERSCAN_ROWS,
      )
    : { start: 0, end: Math.min(totalRows, INITIAL_ROWS) };

  const tiles: ReactNode[] = [];
  for (let r = win.start; r < win.end; r++) {
    const cols = rowLengths[r] ?? 0;
    for (let c = 0; c < cols; c++) {
      const entry = entries[r * GRID_COLUMNS + c];
      if (!entry) continue;
      tiles.push(
        <LibraryTileView
          key={entryId(entry)}
          entry={entry}
          row={r}
          col={c}
          scrollOnFocus={!measured}
        />,
      );
    }
  }

  const gridStyle: CSSProperties = { '--grid-cols': GRID_COLUMNS } as CSSProperties;
  if (measured) gridStyle.transform = `translateY(${win.start * metrics.pitch}px)`;
  const sizerHeight = measured ? Math.max(0, totalRows * metrics.pitch - metrics.gap) : undefined;

  return (
    <FocusProvider
      rowLengths={rowLengths}
      initialPosition={{ row: 0, col: 0 }}
      keyMap={keyMap}
      onSelect={onSelect}
      onBack={onBack}
      onFocusChange={(pos) => setFocusedRow(pos.row)}
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
          ref={scrollRef}
          onScroll={onScroll}
          role="grid"
          aria-label={`${label} — ${entries.length} titles`}
        >
          <div className="library-grid__sizer" style={{ height: sizerHeight }}>
            <div
              className={`library-grid__grid ${measured ? 'is-virtual' : ''}`}
              ref={gridRef}
              style={gridStyle}
            >
              {tiles}
            </div>
          </div>
        </div>
      </div>
    </FocusProvider>
  );
}
