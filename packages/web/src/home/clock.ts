/**
 * Header clock (design-system §12.02). Shows the user's *local* wall-clock
 * time, formatted with their own locale convention (12-hour with AM/PM or
 * 24-hour) — derived entirely on the client, no network (NFR-4 no phone-home).
 */

/**
 * Format a time as hours:minutes in the given (or the runtime default) locale.
 * Pure and deterministic for a fixed date + locale, so it can be unit-tested.
 */
export function formatClockTime(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date);
}

/** Milliseconds from `now` until the start of the next minute (for ticking). */
export function msUntilNextMinute(now: number): number {
  return 60_000 - (now % 60_000);
}
