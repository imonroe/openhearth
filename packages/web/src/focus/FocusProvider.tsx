/**
 * React binding for the focus engine.
 *
 * Holds the single focus position, installs a capture-phase window keydown
 * listener that maps arrow keys to directional moves and `Enter` to select, and
 * exposes `isFocused(row, col)` to tiles. The reserved `home`/`back` keys
 * (FR-A3) are handled here too, at the capture phase with
 * stopImmediatePropagation, so nothing in-app can shadow them; the cross-service
 * guarantee is the kiosk home-guard extension (scripts/kiosk/home-guard).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { move, firstFocusable, keyToDirection, type FocusPosition } from './focusEngine';
import { isHomeKey, isBackKey } from '../reserved';

interface FocusContextValue {
  focused: FocusPosition;
  isFocused: (row: number, col: number) => boolean;
}

const FocusContext = createContext<FocusContextValue | null>(null);

export interface FocusProviderProps {
  /** Number of focusable items per row, top to bottom. */
  rowLengths: number[];
  /** Where focus enters (design-system §9). Defaults to the first focusable. */
  initialPosition?: FocusPosition;
  /** Invoked when `select` (Enter) is pressed, with the focused position. */
  onSelect?: (position: FocusPosition) => void;
  /** Invoked on the reserved `home` key, after focus is reset to entry. */
  onHome?: () => void;
  /** Invoked on the reserved `back` key (navigate one level within OpenHearth). */
  onBack?: () => void;
  children: ReactNode;
}

export function FocusProvider({
  rowLengths,
  initialPosition,
  onSelect,
  onHome,
  onBack,
  children,
}: FocusProviderProps): ReactNode {
  // The `{ 0, 0 }` last-resort fallback is only reached if the grid has no
  // focusable cells at all. Callers must supply at least one non-empty row to
  // honour the "one focused element at all times" invariant (the home screen's
  // header row guarantees this).
  const [focused, setFocused] = useState<FocusPosition>(
    () => initialPosition ?? firstFocusable(rowLengths) ?? { row: 0, col: 0 },
  );

  // Keep the latest grid shape in a ref so the keydown handler (installed once)
  // always reads current row lengths without re-binding on every change.
  const rowLengthsRef = useRef(rowLengths);
  rowLengthsRef.current = rowLengths;

  // Refs so the once-installed keydown handler always reads the latest focus
  // position and onSelect callback without re-binding.
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onHomeRef = useRef(onHome);
  onHomeRef.current = onHome;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const initialPositionRef = useRef(initialPosition);
  initialPositionRef.current = initialPosition;

  // When the grid shape changes (config loaded), re-seat focus if it now points
  // at an empty/out-of-range cell.
  useEffect(() => {
    setFocused((prev) => {
      const len = rowLengths[prev.row] ?? 0;
      if (prev.row < rowLengths.length && prev.col < len) return prev;
      return firstFocusable(rowLengths) ?? { row: 0, col: 0 };
    });
  }, [rowLengths]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Reserved Home/Back first (FR-A3): handled at the capture phase and
      // stopped so no other in-app handler can shadow them.
      if (isHomeKey(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setFocused(
          initialPositionRef.current ?? firstFocusable(rowLengthsRef.current) ?? { row: 0, col: 0 },
        );
        onHomeRef.current?.();
        return;
      }
      if (isBackKey(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onBackRef.current?.();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        onSelectRef.current?.(focusedRef.current);
        return;
      }
      const dir = keyToDirection(event.key);
      if (!dir) return;
      event.preventDefault();
      setFocused((prev) => move(rowLengthsRef.current, prev, dir));
    };
    // Capture phase so the reserved keys can't be shadowed by any other handler.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const isFocused = useCallback(
    (row: number, col: number): boolean => focused.row === row && focused.col === col,
    [focused],
  );

  const value = useMemo<FocusContextValue>(() => ({ focused, isFocused }), [focused, isFocused]);

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

export function useFocus(): FocusContextValue {
  const ctx = useContext(FocusContext);
  if (!ctx) throw new Error('useFocus must be used within a FocusProvider');
  return ctx;
}
