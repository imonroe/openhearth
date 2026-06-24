import { describe, it, expect } from 'vitest';
import { parseMediaPath } from './libraryNaming.js';

describe('parseMediaPath — movies', () => {
  it('parses "Title (Year)" with parens', () => {
    expect(parseMediaPath('Heat (1995).mkv')).toEqual({
      kind: 'movie',
      title: 'Heat',
      year: 1995,
    });
  });

  it('parses dotted scene names and strips quality tags', () => {
    expect(parseMediaPath('Blade.Runner.1982.1080p.BluRay.x264.mkv')).toEqual({
      kind: 'movie',
      title: 'Blade Runner',
      year: 1982,
    });
  });

  it('treats a yearless file in a movies source as a movie', () => {
    expect(parseMediaPath('Some Indie Film.mp4', 'movies')).toEqual({
      kind: 'movie',
      title: 'Some Indie Film',
    });
  });

  it('keeps a year even nested in a folder', () => {
    expect(parseMediaPath('Movies/Inception (2010)/Inception.mkv', 'mixed')).toMatchObject({
      kind: 'movie',
      title: 'Inception',
      year: 2010,
    });
  });
});

describe('parseMediaPath — TV episodes', () => {
  it('parses SxxEyy with show + episode title from a full path', () => {
    expect(
      parseMediaPath('The Office/Season 02/The Office - S02E05 - Halloween.mkv', 'tv'),
    ).toEqual({
      kind: 'episode',
      title: 'The Office',
      season: 2,
      episode: 5,
      episode_title: 'Halloween',
    });
  });

  it('parses compact dotted SxxEyy', () => {
    expect(parseMediaPath('Show.Name.S01E02.mkv')).toEqual({
      kind: 'episode',
      title: 'Show Name',
      season: 1,
      episode: 2,
    });
  });

  it('parses the NxNN convention', () => {
    expect(parseMediaPath('Firefly - 1x03 - Bushwhacked.mkv')).toEqual({
      kind: 'episode',
      title: 'Firefly',
      season: 1,
      episode: 3,
      episode_title: 'Bushwhacked',
    });
  });

  it('derives the show title from the folder when the file has only the marker', () => {
    expect(parseMediaPath('Breaking Bad/Season 03/S03E07.mkv', 'tv')).toEqual({
      kind: 'episode',
      title: 'Breaking Bad',
      season: 3,
      episode: 7,
    });
  });

  it('handles a bare E## inside a Season folder', () => {
    expect(parseMediaPath('Cosmos/Season 1/E04 - Sky and Hell.mkv', 'tv')).toEqual({
      kind: 'episode',
      title: 'Cosmos',
      season: 1,
      episode: 4,
      episode_title: 'Sky and Hell',
    });
  });

  it('parses three-digit episode numbers', () => {
    expect(parseMediaPath('Long Show S01E120.mkv')).toMatchObject({
      season: 1,
      episode: 120,
    });
  });
});

describe('parseMediaPath — fallback / other', () => {
  it('classifies a yearless, markerless file as other', () => {
    expect(parseMediaPath('home video clip.mp4')).toEqual({
      kind: 'other',
      title: 'home video clip',
    });
  });

  it('classifies audio in a music source as other (not a movie)', () => {
    expect(parseMediaPath('Pink Floyd - 1973 - Time.flac', 'music')).toEqual({
      kind: 'other',
      title: 'Pink Floyd - 1973 - Time',
    });
  });

  it('never returns an empty title', () => {
    const parsed = parseMediaPath('.mkv');
    expect(parsed.title.length).toBeGreaterThan(0);
  });
});
