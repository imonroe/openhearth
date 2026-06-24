/**
 * React binding for the focus engine.
 *
 * Holds the single focus position, installs a window keydown listener that maps
 * arrow keys to directional moves, and exposes `isFocused(row, col)` to tiles.
 * `home`/`Enter`/`back` are reserved for later phases (#27/#28) — this scaffold
 * handles directional movement and the visible highlight only.
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
  children: ReactNode;
}

export function FocusProvider({
  rowLengths,
  initialPosition,
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
      const dir = keyToDirection(event.key);
      if (!dir) return;
      event.preventDefault();
      setFocused((prev) => move(rowLengthsRef.current, prev, dir));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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
