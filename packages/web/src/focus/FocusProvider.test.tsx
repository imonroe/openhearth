import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { FocusProvider, useFocus } from './FocusProvider';

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
