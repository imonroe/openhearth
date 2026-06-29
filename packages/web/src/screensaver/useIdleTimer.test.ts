import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIdleTimer } from './useIdleTimer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useIdleTimer (#126)', () => {
  it('fires onIdle after the timeout with no activity', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimer({ timeoutMs: 1000, enabled: true, onIdle }));
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('resets the countdown on interaction', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimer({ timeoutMs: 1000, enabled: true, onIdle }));
    vi.advanceTimersByTime(800);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    vi.advanceTimersByTime(800); // 1600ms total, but only 800ms since the keydown
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimer({ timeoutMs: 1000, enabled: false, onIdle }));
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('ignores zero-distance mousemoves (focus-scroll artefacts)', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimer({ timeoutMs: 1000, enabled: true, onIdle }));
    vi.advanceTimersByTime(900);
    window.dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: 0 }));
    vi.advanceTimersByTime(100); // would have reset if the move counted
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('detaches listeners and timer on unmount', () => {
    const onIdle = vi.fn();
    const { unmount } = renderHook(() => useIdleTimer({ timeoutMs: 1000, enabled: true, onIdle }));
    unmount();
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
