import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { FocusProvider, useFocus, type FocusHandle } from './FocusProvider';

function Probe(): ReactNode {
  const { focused } = useFocus();
  return <div data-testid="pos">{`${focused.row},${focused.col}`}</div>;
}

afterEach(cleanup);

describe('FocusProvider mouse support', () => {
  // A small grid whose cells call focusAt (hover) and activate (click).
  function Grid(): ReactNode {
    const { focused, focusAt, activate } = useFocus();
    return (
      <>
        <div data-testid="pos">{`${focused.row},${focused.col}`}</div>
        {[0, 1].map((col) => (
          <button
            key={col}
            data-testid={`cell-${col}`}
            onMouseEnter={() => focusAt({ row: 0, col })}
            onClick={() => activate({ row: 0, col })}
          />
        ))}
      </>
    );
  }

  it('focusAt moves focus on hover without selecting', () => {
    const onSelect = vi.fn();
    const { getByTestId } = render(
      <FocusProvider rowLengths={[2]} initialPosition={{ row: 0, col: 0 }} onSelect={onSelect}>
        <Grid />
      </FocusProvider>,
    );
    expect(getByTestId('pos').textContent).toBe('0,0');
    fireEvent.mouseEnter(getByTestId('cell-1'));
    expect(getByTestId('pos').textContent).toBe('0,1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('activate focuses the clicked cell and fires onSelect with its position', () => {
    const onSelect = vi.fn();
    const { getByTestId } = render(
      <FocusProvider rowLengths={[2]} initialPosition={{ row: 0, col: 0 }} onSelect={onSelect}>
        <Grid />
      </FocusProvider>,
    );
    fireEvent.click(getByTestId('cell-1'));
    expect(getByTestId('pos').textContent).toBe('0,1');
    expect(onSelect).toHaveBeenCalledWith({ row: 0, col: 1 });
  });
});

describe('FocusProvider reserved Home/Back (FR-A3)', () => {
  it('Home resets focus to the entry position and calls onHome', () => {
    const onHome = vi.fn();
    const { getByTestId } = render(
      <FocusProvider rowLengths={[2, 3]} initialPosition={{ row: 1, col: 0 }} onHome={onHome}>
        <Probe />
      </FocusProvider>,
    );
    expect(getByTestId('pos').textContent).toBe('1,0');

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(getByTestId('pos').textContent).toBe('1,1');

    fireEvent.keyDown(window, { key: 'Home' });
    expect(getByTestId('pos').textContent).toBe('1,0'); // reset to entry
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('Back invokes onBack', () => {
    const onBack = vi.fn();
    render(
      <FocusProvider rowLengths={[2, 3]} initialPosition={{ row: 1, col: 0 }} onBack={onBack}>
        <Probe />
      </FocusProvider>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('a later-registered handler (capture or bubble) cannot shadow the reserved key', () => {
    const laterBubble = vi.fn();
    const laterCapture = vi.fn();
    render(
      <FocusProvider rowLengths={[2]} initialPosition={{ row: 0, col: 0 }}>
        <Probe />
      </FocusProvider>,
    );
    // Handlers added AFTER the provider must NOT receive the reserved key,
    // because the provider intercepts it at the capture phase and calls
    // stopImmediatePropagation — in both the capture and bubble phases.
    window.addEventListener('keydown', laterBubble);
    window.addEventListener('keydown', laterCapture, true);
    fireEvent.keyDown(window, { key: 'Home' });
    window.removeEventListener('keydown', laterBubble);
    window.removeEventListener('keydown', laterCapture, true);
    expect(laterBubble).not.toHaveBeenCalled();
    expect(laterCapture).not.toHaveBeenCalled();
  });
});

describe('FocusProvider region coordination (#131)', () => {
  it('does not consume keys while inactive', () => {
    const { getByTestId } = render(
      <FocusProvider rowLengths={[3]} initialPosition={{ row: 0, col: 0 }} active={false}>
        <Probe />
      </FocusProvider>,
    );
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(getByTestId('pos').textContent).toBe('0,0'); // no movement — listener is off
  });

  it('fires onNavigateEdge when a move is blocked at an edge', () => {
    const onNavigateEdge = vi.fn();
    const { getByTestId } = render(
      <FocusProvider
        rowLengths={[2]}
        initialPosition={{ row: 0, col: 0 }}
        onNavigateEdge={onNavigateEdge}
      >
        <Probe />
      </FocusProvider>,
    );
    // Left at col 0 is blocked → edge callback, focus unchanged.
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onNavigateEdge).toHaveBeenCalledWith('left');
    expect(getByTestId('pos').textContent).toBe('0,0');
    // A move that DOES change position must not fire the edge callback.
    onNavigateEdge.mockClear();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(getByTestId('pos').textContent).toBe('0,1');
    expect(onNavigateEdge).not.toHaveBeenCalled();
  });

  it('exposes an imperative focusAt that validates against the grid shape', () => {
    const ref = createRef<FocusHandle>();
    const { getByTestId } = render(
      <FocusProvider ref={ref} rowLengths={[2, 4]} initialPosition={{ row: 0, col: 0 }}>
        <Probe />
      </FocusProvider>,
    );
    act(() => ref.current!.focusAt({ row: 1, col: 3 }));
    expect(getByTestId('pos').textContent).toBe('1,3');
    // Out-of-range requests are ignored (no blank focus).
    act(() => ref.current!.focusAt({ row: 5, col: 0 }));
    expect(getByTestId('pos').textContent).toBe('1,3');
    act(() => ref.current!.focusAt({ row: 0, col: 9 }));
    expect(getByTestId('pos').textContent).toBe('1,3');
  });
});
