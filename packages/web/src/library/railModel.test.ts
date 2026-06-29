import { describe, it, expect } from 'vitest';
import type { LibraryItem } from '@openhearth/shared';
import {
  bucketForTitle,
  buildRailSections,
  railRowLengths,
  rowForIndex,
  sectionIndexForEntry,
  NON_ALPHA,
} from './railModel';
import { buildLibraryEntries } from './libraryModel';

function movie(title: string): LibraryItem {
  return {
    id: title,
    source_id: 'movies',
    kind: 'movie',
    path: `/m/${title}.mkv`,
    title,
    mtime: 1,
    indexed_at: 1,
  };
}

describe('bucketForTitle (#131)', () => {
  it('uppercases the first letter', () => {
    expect(bucketForTitle('arrival')).toBe('A');
    expect(bucketForTitle('Dune')).toBe('D');
  });
  it('buckets non-letters under #', () => {
    expect(bucketForTitle('2001: A Space Odyssey')).toBe(NON_ALPHA);
    expect(bucketForTitle('[REC]')).toBe(NON_ALPHA);
  });
  it('ignores leading whitespace', () => {
    expect(bucketForTitle('  Zodiac')).toBe('Z');
  });
});

describe('buildRailSections (#131)', () => {
  // Sorted entries: "2001" (#), Arrival (A), Akira (A), Dune (D).
  const entries = buildLibraryEntries(
    [movie('Dune'), movie('Arrival'), movie('2001'), movie('Akira')].map((m) => m),
  );

  it('includes # only when there are non-alphabetic titles, then A–Z', () => {
    const sections = buildRailSections(entries);
    expect(sections[0]?.letter).toBe(NON_ALPHA);
    expect(
      sections
        .slice(1)
        .map((s) => s.letter)
        .join(''),
    ).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  });

  it('omits # when every title starts with a letter', () => {
    const lettersOnly = buildRailSections(buildLibraryEntries([movie('Arrival'), movie('Dune')]));
    expect(lettersOnly[0]?.letter).toBe('A');
    expect(lettersOnly.some((s) => s.letter === NON_ALPHA)).toBe(false);
  });

  it('marks firstIndex at the first entry of each bucket and disables empty letters', () => {
    const sections = buildRailSections(entries);
    const byLetter = Object.fromEntries(sections.map((s) => [s.letter, s]));
    // Sorted order: 0:"2001"(#), 1:Akira(A), 2:Arrival(A), 3:Dune(D).
    expect(byLetter[NON_ALPHA]).toMatchObject({ firstIndex: 0, enabled: true });
    expect(byLetter['A']).toMatchObject({ firstIndex: 1, enabled: true }); // first A = Akira
    expect(byLetter['D']).toMatchObject({ firstIndex: 3, enabled: true });
    expect(byLetter['B']).toMatchObject({ firstIndex: -1, enabled: false });
  });
});

describe('railRowLengths (#131)', () => {
  it('is 1 for enabled letters and 0 for empty ones (focus skips empties)', () => {
    const sections = buildRailSections(buildLibraryEntries([movie('Arrival'), movie('Dune')]));
    const lengths = railRowLengths(sections);
    expect(lengths[0]).toBe(1); // A
    expect(lengths[1]).toBe(0); // B (empty)
    expect(lengths[3]).toBe(1); // D
  });
});

describe('rowForIndex (#131)', () => {
  it('maps an entry index to its grid row', () => {
    expect(rowForIndex(0, 6)).toBe(0);
    expect(rowForIndex(5, 6)).toBe(0);
    expect(rowForIndex(6, 6)).toBe(1);
    expect(rowForIndex(13, 6)).toBe(2);
  });
});

describe('sectionIndexForEntry (#131)', () => {
  const entries = buildLibraryEntries([movie('2001'), movie('Akira'), movie('Dune')]);
  const sections = buildRailSections(entries);

  const letterAt = (i: number): string | undefined => sections[i]?.letter;

  it('returns the rail index of the section the entry belongs to', () => {
    // sections: 0:#, 1:A, 2:B, 3:C, 4:D, ...
    expect(letterAt(sectionIndexForEntry(sections, 0, entries))).toBe(NON_ALPHA); // 2001
    expect(letterAt(sectionIndexForEntry(sections, 1, entries))).toBe('A'); // Akira
    expect(letterAt(sectionIndexForEntry(sections, 2, entries))).toBe('D'); // Dune
  });

  it('falls back to the first enabled section for an out-of-range entry', () => {
    const idx = sectionIndexForEntry(sections, 999, entries);
    expect(sections[idx]?.enabled).toBe(true);
  });
});
