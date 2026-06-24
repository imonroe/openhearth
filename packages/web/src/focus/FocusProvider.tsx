/**
 * React binding for the focus engine.
 *
 * Holds the single focus position and installs a capture-phase window keydown
 * listener driven by the configured key→action map (keybindings.ts): navigate
 * moves focus, select fires onSelect, and any other action is routed to onAction
 * (the control path). The reserved `home`/`back` actions (FR-A3) are stopped at
 * the capture phase with stopImmediatePropagation, so no *later-registered*
 * in-app handler can shadow them (OpenHearth owns its own page and registers no
 * earlier key listener). The cross-service guarantee is the kiosk home-guard
 * extension (scripts/kiosk/home-guard).
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
import { move, firstFocusable, type Direction, type FocusPosition } from './focusEngine';
import { buildKeyMap, type KeyMap } from '../keybindings';
import type { ActionName } from '@openhearth/shared';

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
  /** physical-key → action map (from config). Defaults when omitted. */
  keyMap?: KeyMap;
  /** Invoked when the `select` action fires, with the focused position. */
  onSelect?: (position: FocusPosition) => void;
  /** Invoked on the reserved `home` action, after focus is reset to entry. */
  onHome?: () => void;
  /** Invoked on the reserved `back` action (one level within OpenHearth). */
  onBack?: () => void;
  /** Invoked for any non-focus action (play_pause, stop, …) — routed to the
   *  control path, exactly like a phone remote would. */
  onAction?: (action: ActionName, params?: Record<string, unknown>) => void;
  children: ReactNode;
}

const DEFAULT_KEY_MAP = buildKeyMap();

export function FocusProvider({
  rowLengths,
  initialPosition,
  keyMap,
  onSelect,
  onHome,
  onBack,
  onAction,
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
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  const keyMapRef = useRef(keyMap ?? DEFAULT_KEY_MAP);
  keyMapRef.current = keyMap ?? DEFAULT_KEY_MAP;
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
      const bound = keyMapRef.current.get(event.key);
      if (!bound) return;
      event.preventDefault();

      switch (bound.action) {
        case 'home':
          // Reserved (FR-A3): stop so no later-registered in-app handler can
          // shadow it; reset focus to entry.
          event.stopImmediatePropagation();
          setFocused(
            initialPositionRef.current ??
              firstFocusable(rowLengthsRef.current) ?? { row: 0, col: 0 },
          );
          onHomeRef.current?.();
          return;
        case 'back':
          event.stopImmediatePropagation();
          onBackRef.current?.();
          return;
        case 'select':
          onSelectRef.current?.(focusedRef.current);
          return;
        case 'navigate':
          setFocused((prev) =>
            move(rowLengthsRef.current, prev, bound.params?.direction as Direction),
          );
          return;
        default:
          // Any other action (play_pause, stop, seek, …) is routed to the
          // control path — no keyboard-specific handling here.
          onActionRef.current?.(bound.action, bound.params);
          return;
      }
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
