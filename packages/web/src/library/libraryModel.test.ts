import { describe, it, expect } from 'vitest';
import type { LibraryItem } from '@openhearth/shared';
import { buildLibraryEntries, isShow, episodesInSeason, type ShowGroup } from './libraryModel';

function item(over: Partial<LibraryItem>): LibraryItem {
  return {
    id: Math.random().toString(36).slice(2),
    source_id: 's',
    kind: 'movie',
    path: '/p',
    title: 'T',
    mtime: 1,
    indexed_at: 1,
    ...over,
  };
}

describe('buildLibraryEntries', () => {
  it('passes movies through and sorts by title', () => {
    const entries = buildLibraryEntries([
      item({ kind: 'movie', title: 'Charlie', year: 2003 }),
      item({ kind: 'movie', title: 'Alpha', year: 2001 }),
    ]);
    expect(entries.map((e) => e.title)).toEqual(['Alpha', 'Charlie']);
    expect(entries.every((e) => !isShow(e))).toBe(true);
  });

  it('groups episodes into one show with sorted seasons + episodes', () => {
    const entries = buildLibraryEntries([
      item({ kind: 'episode', title: 'The Office', season: 2, episode: 1, year: 2005 }),
      item({ kind: 'episode', title: 'The Office', season: 1, episode: 2, year: 2005 }),
      item({ kind: 'episode', title: 'The Office', season: 1, episode: 1, year: 2005 }),
    ]);
    expect(entries).toHaveLength(1);
    const show = entries[0] as ShowGroup;
    expect(isShow(show)).toBe(true);
    expect(show.id).toBe('show:The Office');
    expect(show.seasons).toEqual([1, 2]);
    expect(show.episodes.map((e) => [e.season, e.episode])).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
    ]);
    expect(episodesInSeason(show, 1)).toHaveLength(2);
    expect(episodesInSeason(show, 2)).toHaveLength(1);
  });

  it('mixes movies and shows, sorted together by title', () => {
    const entries = buildLibraryEntries([
      item({ kind: 'episode', title: 'Breaking Bad', season: 1, episode: 1 }),
      item({ kind: 'movie', title: 'Avatar', year: 2009 }),
      item({ kind: 'other', title: 'home clip' }),
    ]);
    expect(entries.map((e) => e.title)).toEqual(['Avatar', 'Breaking Bad', 'home clip']);
    expect(entries.filter(isShow)).toHaveLength(1);
  });

  it('uses the earliest episode year as the show year', () => {
    const entries = buildLibraryEntries([
      item({ kind: 'episode', title: 'Show', season: 2, episode: 1, year: 2012 }),
      item({ kind: 'episode', title: 'Show', season: 1, episode: 1, year: 2010 }),
    ]);
    expect((entries[0] as ShowGroup).year).toBe(2010);
  });
});
