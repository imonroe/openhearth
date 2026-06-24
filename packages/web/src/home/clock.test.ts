import { describe, it, expect } from 'vitest';
import { formatClockTime, msUntilNextMinute } from './clock';

describe('formatClockTime', () => {
  // Parsed without a trailing 'Z' → local time, then formatted in the same
  // local zone, so these are stable regardless of the test runner's timezone.
  const afternoon = new Date('2026-06-24T20:42:00');
  const morning = new Date('2026-06-24T08:05:00');
  const midnight = new Date('2026-06-24T00:00:00');

  it('uses 12-hour AM/PM for a 12-hour locale', () => {
    expect(formatClockTime(afternoon, 'en-US')).toBe('8:42 PM');
    expect(formatClockTime(morning, 'en-US')).toBe('8:05 AM');
    expect(formatClockTime(midnight, 'en-US')).toBe('12:00 AM');
  });

  it('uses 24-hour for a 24-hour locale', () => {
    expect(formatClockTime(afternoon, 'en-GB')).toBe('20:42');
    // `hour: 'numeric'` keeps the locale-natural unpadded hour (no leading zero).
    expect(formatClockTime(morning, 'en-GB')).toBe('8:05');
  });

  it('always zero-pads the minutes', () => {
    expect(formatClockTime(morning, 'en-US')).toContain(':05');
    expect(formatClockTime(morning, 'en-GB')).toContain(':05');
  });
});

describe('msUntilNextMinute', () => {
  it('returns the remainder to the next whole minute', () => {
    expect(msUntilNextMinute(0)).toBe(60_000);
    expect(msUntilNextMinute(59_000)).toBe(1_000);
    expect(msUntilNextMinute(60_000)).toBe(60_000);
    expect(msUntilNextMinute(90_500)).toBe(29_500);
  });
});
