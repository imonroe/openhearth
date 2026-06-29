/**
 * Pure formatting helpers for the movie detail screen's rich metadata (#123).
 * Framework-free so they unit-test without a DOM.
 */

/** Format a runtime in minutes as `2h 16m` / `47m` / `1h`. Empty for ≤ 0 / unknown. */
export function formatRuntime(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Format a 0–10 rating as `8.2`. Empty for ≤ 0 / unknown. */
export function formatRating(rating: number | null | undefined): string {
  if (rating == null || !Number.isFinite(rating) || rating <= 0) return '';
  return (Math.round(rating * 10) / 10).toFixed(1);
}
