/**
 * A–Z jump rail model (#131).
 *
 * The full-library grid is sorted alphabetically, so jumping to a letter is just
 * "find the first entry whose title starts with that letter and focus it". These
 * pure helpers derive the rail's sections (`#`, then `A`–`Z`) and the first
 * matching entry index for each, so a letter maps to a grid row in O(1). Empty
 * letters are marked disabled (shown dimmed, skipped by focus navigation).
 *
 * Framework-free so it unit-tests without a DOM.
 */
import { entryTitle, type LibraryEntry } from './libraryModel';

/** Sentinel section for titles that don't start with a Latin letter (digits, etc.). */
export const NON_ALPHA = '#';

/**
 * The rail bucket a title falls in: its uppercased first character if it's
 * `A`–`Z`, otherwise the `#` (non-alphabetic) bucket. Leading whitespace is
 * ignored so " The Wire" still buckets under `T`-less… (titles are pre-trimmed,
 * but be defensive).
 */
export function bucketForTitle(title: string): string {
  const c = title.trimStart().charAt(0).toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : NON_ALPHA;
}

/** One rail entry: its letter, the first matching grid index (or -1), enabled flag. */
export interface RailSection {
  letter: string;
  /** Index into the sorted entries of the first title in this bucket, or -1. */
  firstIndex: number;
  enabled: boolean;
}

/**
 * Build the rail sections for a sorted entry list: `#` (only when there are
 * non-alphabetic titles) followed by `A`–`Z` (always shown, disabled when
 * empty). `firstIndex` is the index of the first entry in each bucket.
 */
export function buildRailSections(entries: readonly LibraryEntry[]): RailSection[] {
  const firstIndex = new Map<string, number>();
  entries.forEach((entry, i) => {
    const bucket = bucketForTitle(entryTitle(entry));
    if (!firstIndex.has(bucket)) firstIndex.set(bucket, i);
  });

  const letters: string[] = [];
  if (firstIndex.has(NON_ALPHA)) letters.push(NON_ALPHA);
  for (let code = 65; code <= 90; code++) letters.push(String.fromCharCode(code));

  return letters.map((letter) => ({
    letter,
    firstIndex: firstIndex.get(letter) ?? -1,
    enabled: firstIndex.has(letter),
  }));
}

/** Per-row focusable counts for the rail FocusProvider: 1 if enabled, else 0
 *  (so the focus engine skips disabled letters when moving up/down). */
export function railRowLengths(sections: readonly RailSection[]): number[] {
  return sections.map((s) => (s.enabled ? 1 : 0));
}

/** The grid row (0-based) that holds entry `index`, given the column count. */
export function rowForIndex(index: number, columns: number): number {
  return Math.floor(index / columns);
}

/** The rail section index for a given grid entry index — i.e. which letter the
 *  entry under focus belongs to — so entering the rail can land on it. */
export function sectionIndexForEntry(
  sections: readonly RailSection[],
  entryIndex: number,
  entries: readonly LibraryEntry[],
): number {
  const entry = entries[entryIndex];
  if (!entry) return sections.findIndex((s) => s.enabled);
  const bucket = bucketForTitle(entryTitle(entry));
  const found = sections.findIndex((s) => s.letter === bucket && s.enabled);
  return found >= 0 ? found : sections.findIndex((s) => s.enabled);
}
