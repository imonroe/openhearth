import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { FocusProvider, useFocus } from './FocusProvider';

function Probe(): ReactNode {
  const { focused } = useFocus();
  return <div data-testid="pos">{`${focused.row},${focused.col}`}</div>;
}

afterEach(cleanup);

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
