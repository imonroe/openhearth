import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { LibraryItem, MediaItem } from '@openhearth/shared';
import { LibraryDetail } from './LibraryDetail';
import { buildKeyMap } from '../keybindings';
import * as api from '../api';

vi.mock('../api', () => ({ fetchItemMetadata: vi.fn(async () => null) }));

const keyMap = buildKeyMap();

function movie(over: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: 'm1',
    source_id: 'movies',
    kind: 'movie',
    path: '/m/x.mkv',
    title: 'The Matrix',
    year: 1999,
    mtime: 1,
    indexed_at: 1,
    ...over,
  };
}

function renderDetail(over: Partial<LibraryItem> = {}) {
  const dispatch = vi.fn();
  const onPlay = vi.fn();
  const onBack = vi.fn();
  render(
    <LibraryDetail
      entry={movie(over)}
      keyMap={keyMap}
      dispatch={dispatch}
      onBack={onBack}
      onPlay={onPlay}
    />,
  );
  return { dispatch, onPlay, onBack };
}

const setMeta = (m: MediaItem | null) =>
  (api.fetchItemMetadata as ReturnType<typeof vi.fn>).mockResolvedValue(m);

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('MovieDetail rich metadata (#123)', () => {
  it('renders overview, runtime, rating, genres, cast and directors', async () => {
    setMeta({
      id: 'tmdb:movie:603',
      title: 'The Matrix',
      kind: 'movie',
      overview: 'A hacker learns the truth about his reality.',
      runtime_minutes: 136,
      rating: 8.2,
      genres: ['Science Fiction', 'Action'],
      directors: ['Lana Wachowski', 'Lilly Wachowski'],
      cast: [
        { name: 'Keanu Reeves', character: 'Neo' },
        { name: 'Carrie-Anne Moss', character: 'Trinity' },
      ],
    });
    renderDetail();

    // The overview arrives asynchronously.
    expect(await screen.findByText(/A hacker learns the truth/)).toBeTruthy();
    // Submeta combines year · runtime · ★ rating.
    expect(screen.getByText('1999 · 2h 16m · ★ 8.2')).toBeTruthy();
    expect(screen.getByText('Science Fiction')).toBeTruthy();
    expect(screen.getByText('Action')).toBeTruthy();
    expect(screen.getByText('Keanu Reeves')).toBeTruthy();
    expect(screen.getByText(/as Neo/)).toBeTruthy();
    expect(screen.getByText('Directors')).toBeTruthy();
    expect(screen.getByText(/Lana Wachowski, Lilly Wachowski/)).toBeTruthy();
    expect(api.fetchItemMetadata).toHaveBeenCalledWith('m1', expect.anything());
  });

  it('shows just the basic view when metadata does not resolve', async () => {
    setMeta(null);
    renderDetail();
    expect(screen.getByText('The Matrix')).toBeTruthy();
    expect(screen.getByText('1999')).toBeTruthy(); // year only, no runtime/rating
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    // Give the (null) fetch a tick; nothing rich should appear.
    await Promise.resolve();
    expect(screen.queryByText('Cast')).toBeNull();
  });

  it('still plays on Enter (basic behavior preserved)', () => {
    const { dispatch, onPlay } = renderDetail();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledWith('play_item', { id: 'm1' });
    expect(onPlay).toHaveBeenCalled();
  });

  it('uses singular "Director" for a single director', async () => {
    setMeta({
      id: 'tmdb:movie:1',
      title: 'The Matrix',
      kind: 'movie',
      directors: ['Lana Wachowski'],
    });
    renderDetail();
    expect(await screen.findByText('Director')).toBeTruthy();
  });
});
