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
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
  type ReactNode,
} from 'react';
import { move, firstFocusable, type Direction, type FocusPosition } from './focusEngine';
import { buildKeyMap, type KeyMap } from '../keybindings';
import type { ActionName } from '@openhearth/shared';

interface FocusContextValue {
  focused: FocusPosition;
  isFocused: (row: number, col: number) => boolean;
  /** Move focus to a cell without selecting it — for mouse hover. */
  focusAt: (position: FocusPosition) => void;
  /** Focus a cell and fire its `select` action — for a mouse click. */
  activate: (position: FocusPosition) => void;
}

const FocusContext = createContext<FocusContextValue | null>(null);

/** Imperative handle (via ref) for moving focus from outside the provider. */
export interface FocusHandle {
  /** Move focus to a cell, if it's a valid focusable position. No-op otherwise. */
  focusAt: (position: FocusPosition) => void;
}

export interface FocusProviderProps {
  /** Number of focusable items per row, top to bottom. */
  rowLengths: number[];
  /** Where focus enters (design-system §9). Defaults to the first focusable. */
  initialPosition?: FocusPosition;
  /** physical-key → action map (from config). Defaults when omitted. */
  keyMap?: KeyMap;
  /**
   * Whether this provider's keyboard listener is live. Defaults to true. Set
   * false to keep the provider mounted (and its focus state + highlight) but
   * stop it consuming keys — used when two focus regions coexist (e.g. the
   * library grid and its A–Z rail) and only one is active at a time.
   */
  active?: boolean;
  /** Invoked when the `select` action fires, with the focused position. */
  onSelect?: (position: FocusPosition) => void;
  /** Invoked on the reserved `home` action, after focus is reset to entry. */
  onHome?: () => void;
  /** Invoked on the reserved `back` action (one level within OpenHearth). */
  onBack?: () => void;
  /** Invoked for any non-focus action (play_pause, stop, …) — routed to the
   *  control path, exactly like a phone remote would. */
  onAction?: (action: ActionName, params?: Record<string, unknown>) => void;
  /** Invoked whenever the focused position changes (e.g. to derive live state
   *  like the active TV season from a focused tab). */
  onFocusChange?: (position: FocusPosition) => void;
  /**
   * Invoked when a `navigate` is blocked at an edge (the move didn't change the
   * position). Lets a parent hand off to an adjacent focus region — e.g. Left at
   * the grid's first column crosses into the A–Z rail (#131).
   */
  onNavigateEdge?: (direction: Direction) => void;
  children: ReactNode;
}

const DEFAULT_KEY_MAP = buildKeyMap();

function FocusProviderInner(
  {
    rowLengths,
    initialPosition,
    keyMap,
    active = true,
    onSelect,
    onHome,
    onBack,
    onAction,
    onFocusChange,
    onNavigateEdge,
    children,
  }: FocusProviderProps,
  ref: ForwardedRef<FocusHandle>,
): ReactNode {
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
  const onNavigateEdgeRef = useRef(onNavigateEdge);
  onNavigateEdgeRef.current = onNavigateEdge;
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
        case 'navigate': {
          const dir = bound.params?.direction;
          if (dir === 'up' || dir === 'down' || dir === 'left' || dir === 'right') {
            // Compute the move outside setFocused so a blocked edge can notify a
            // parent (to hand off to an adjacent region) without a side effect
            // inside the state updater (which StrictMode would double-invoke).
            const prev = focusedRef.current;
            const next = move(rowLengthsRef.current, prev, dir);
            if (next.row === prev.row && next.col === prev.col) onNavigateEdgeRef.current?.(dir);
            else setFocused(next);
          }
          return;
        }
        default:
          // Any other action (play_pause, stop, seek, …) is routed to the
          // control path — no keyboard-specific handling here.
          onActionRef.current?.(bound.action, bound.params);
          return;
      }
    };
    // Capture phase so the reserved keys can't be shadowed by any other handler.
    // Only the active region listens, so coexisting regions don't both consume a
    // key (re-binds when `active` flips).
    if (!active) return;
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active]);

  // Notify listeners when focus moves (e.g. to derive the active TV season from
  // the focused season tab). Kept in a ref so we don't re-bind on every change.
  const onFocusChangeRef = useRef(onFocusChange);
  onFocusChangeRef.current = onFocusChange;
  useEffect(() => {
    onFocusChangeRef.current?.(focused);
  }, [focused]);

  const isFocused = useCallback(
    (row: number, col: number): boolean => focused.row === row && focused.col === col,
    [focused],
  );

  // Mouse support: hovering a cell focuses it; clicking focuses and selects.
  // Keyboard stays primary — these mirror the keydown handler's `navigate` and
  // `select` paths so a click behaves exactly like focusing then pressing Enter.
  const focusAt = useCallback((position: FocusPosition): void => {
    setFocused((prev) =>
      prev.row === position.row && prev.col === position.col ? prev : position,
    );
  }, []);
  const activate = useCallback((position: FocusPosition): void => {
    setFocused(position);
    onSelectRef.current?.(position);
  }, []);

  // Imperative focus for a parent coordinating regions (e.g. landing grid focus
  // on the row an A–Z jump targeted). Validates against the current shape so an
  // out-of-range request is a safe no-op.
  useImperativeHandle(
    ref,
    (): FocusHandle => ({
      focusAt: (position) => {
        const lengths = rowLengthsRef.current;
        const len = lengths[position.row] ?? 0;
        if (
          position.row >= 0 &&
          position.row < lengths.length &&
          position.col >= 0 &&
          position.col < len
        ) {
          setFocused(position);
        }
      },
    }),
    [],
  );

  const value = useMemo<FocusContextValue>(
    () => ({ focused, isFocused, focusAt, activate }),
    [focused, isFocused, focusAt, activate],
  );

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

/** Focus engine React binding. Forwards a {@link FocusHandle} ref. */
export const FocusProvider = forwardRef(FocusProviderInner);

export function useFocus(): FocusContextValue {
  const ctx = useContext(FocusContext);
  if (!ctx) throw new Error('useFocus must be used within a FocusProvider');
  return ctx;
}
