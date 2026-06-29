import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Screensaver } from './Screensaver';

afterEach(() => vi.restoreAllMocks());

describe('Screensaver overlay (#126)', () => {
  it('renders the selected saver', () => {
    render(<Screensaver type="aurora" onWake={vi.fn()} />);
    expect(screen.getByTestId('aurora')).toBeTruthy();
  });

  it('wakes on the first keypress and consumes the event', () => {
    const onWake = vi.fn();
    render(<Screensaver type="aurora" onWake={onWake} />);
    const ev = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    window.dispatchEvent(ev);
    expect(onWake).toHaveBeenCalledTimes(1);
    // The waking key is swallowed so it doesn't also act on the UI underneath.
    expect(ev.defaultPrevented).toBe(true);
  });

  it('stops the waking event from reaching later-registered handlers', () => {
    const onWake = vi.fn();
    render(<Screensaver type="aurora" onWake={onWake} />);
    // A handler registered after the overlay mounted (i.e. the kind of in-app
    // handler that would sit beneath it) must not see the waking key.
    const underneath = vi.fn();
    window.addEventListener('keydown', underneath, true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    window.removeEventListener('keydown', underneath, true);
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(underneath).not.toHaveBeenCalled();
  });

  it('does not wake on a zero-distance mousemove', () => {
    const onWake = vi.fn();
    render(<Screensaver type="aurora" onWake={onWake} />);
    window.dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: 0 }));
    expect(onWake).not.toHaveBeenCalled();
  });

  it('detaches its listeners on unmount', () => {
    const onWake = vi.fn();
    const { unmount } = render(<Screensaver type="aurora" onWake={onWake} />);
    unmount();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(onWake).not.toHaveBeenCalled();
  });
});
