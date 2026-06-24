/**
 * Normalized media model tests (#40): schema validation (incl. the reserved
 * availability slot) and the library-item → MediaItem projection.
 */
import { describe, it, expect } from 'vitest';
import { mediaItemSchema, mediaItemFromLibraryItem, MEDIA_KINDS, type MediaItem } from './index.js';
import type { LibraryItem } from '../library/index.js';

function libraryItem(over: Partial<LibraryItem>): LibraryItem {
  return {
    id: 'lib-1',
    source_id: 'media',
    kind: 'movie',
    path: '/media/Heat (1995).mkv',
    title: 'Heat',
    mtime: 1,
    indexed_at: 1,
    ...over,
  };
}

describe('mediaItemSchema', () => {
  it('accepts a minimal item and a fully-populated one (with reserved availability)', () => {
    const minimal: MediaItem = { id: 'x', title: 'X', kind: 'movie' };
    expect(mediaItemSchema.safeParse(minimal).success).toBe(true);

    const full: MediaItem = {
      id: 'tmdb:movie:603',
      title: 'The Matrix',
      year: 1999,
      kind: 'movie',
      overview: 'A hacker learns the truth.',
      artwork: { poster_url: 'https://img/p.jpg', backdrop_url: 'https://img/b.jpg' },
      ids: { tmdb: '603', imdb: 'tt0133093' },
      availability: [{ service: 'netflix', offer: 'stream', region: 'US' }],
    };
    expect(mediaItemSchema.safeParse(full).success).toBe(true);
  });

  it('rejects unknown keys (strict) and an empty title', () => {
    expect(
      mediaItemSchema.safeParse({ id: 'x', title: 'X', kind: 'movie', bogus: 1 }).success,
    ).toBe(false);
    expect(mediaItemSchema.safeParse({ id: 'x', title: '', kind: 'movie' }).success).toBe(false);
  });

  it('ids is a free-form source→id map (extensible, no model change per provider)', () => {
    const parsed = mediaItemSchema.safeParse({
      id: 'x',
      title: 'X',
      kind: 'movie',
      ids: { tmdb: '1', somefutureprovider: 'abc' },
    });
    expect(parsed.success).toBe(true);
  });

  it('covers every declared kind', () => {
    for (const kind of MEDIA_KINDS) {
      expect(mediaItemSchema.safeParse({ id: 'x', title: 'X', kind }).success).toBe(true);
    }
  });
});

describe('mediaItemFromLibraryItem', () => {
  it('projects a movie, carrying title + year', () => {
    expect(mediaItemFromLibraryItem(libraryItem({ year: 1995 }))).toEqual({
      id: 'lib-1',
      title: 'Heat',
      kind: 'movie',
      year: 1995,
    });
  });

  it('maps episode → episode and other → other, omitting absent year', () => {
    expect(mediaItemFromLibraryItem(libraryItem({ kind: 'episode' })).kind).toBe('episode');
    expect(mediaItemFromLibraryItem(libraryItem({ kind: 'other' })).kind).toBe('other');
    expect(mediaItemFromLibraryItem(libraryItem({ year: null })).year).toBeUndefined();
  });

  it('produces a schema-valid item', () => {
    const item = mediaItemFromLibraryItem(libraryItem({ year: 1995 }));
    expect(mediaItemSchema.safeParse(item).success).toBe(true);
  });
});
