import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Clock } from './Clock';
import { formatClockTime } from './clock';

describe('<Clock>', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-24T20:42:30'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the current local time and advances on the minute boundary', () => {
    render(<Clock />);
    const expectedAt = (iso: string): string => formatClockTime(new Date(iso));

    const clock = screen.getByText(expectedAt('2026-06-24T20:42:30'));
    expect(clock.tagName).toBe('TIME');
    expect(clock.getAttribute('datetime')).toBeTruthy();

    // Advance to just past the next minute boundary — the display updates.
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    // getByText throws if absent, so this asserts the new minute is shown.
    expect(screen.getByText(expectedAt('2026-06-24T20:43:01'))).toBeDefined();
  });
});
