import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { LibraryItem } from '@openhearth/shared';
import { Player } from './Player';
import { buildKeyMap } from '../keybindings';

const keyMap = buildKeyMap();

const item: LibraryItem = {
  id: 'm1',
  source_id: 'movies',
  kind: 'movie',
  path: '/m/x.mkv',
  title: 'Arrival',
  mtime: 1,
  indexed_at: 1,
};

let resumeValue: { position_sec: number; updated_at: number } | null;
let putBodies: string[];
let deleteCount: number;
let subsValue: Array<{ id: string; label: string; lang?: string | null; source: string }>;

function videoEl(container: HTMLElement): HTMLVideoElement | null {
  return container.querySelector('video');
}

beforeEach(() => {
  resumeValue = null;
  putBodies = [];
  deleteCount = 0;
  subsValue = [];
  // jsdom doesn't implement media playback — stub the methods we call.
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, opts?: { method?: string; body?: string }) => {
      if (url.includes('/resume')) {
        if (opts?.method === 'PUT' && opts.body) putBodies.push(opts.body);
        if (opts?.method === 'DELETE') deleteCount += 1;
        const body = opts?.method ? { status: 'ok' } : resumeValue;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
      }
      if (url.includes('/subtitles')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(subsValue) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('Player', () => {
  it('plays from the start when there is no saved resume position', async () => {
    const { container } = render(
      <Player item={item} keyMap={keyMap} dispatch={vi.fn()} onExit={vi.fn()} onHome={vi.fn()} />,
    );
    await waitFor(() => expect(videoEl(container)).toBeTruthy());
    // No resume → stream URL carries no ?t offset.
    expect(videoEl(container)!.getAttribute('src')).toBe('/api/v1/library/m1/stream');
  });

  it('offers a resume prompt and resumes from the saved position (?t)', async () => {
    resumeValue = { position_sec: 125, updated_at: 1 };
    const { container } = render(
      <Player item={item} keyMap={keyMap} dispatch={vi.fn()} onExit={vi.fn()} onHome={vi.fn()} />,
    );
    // Prompt offers Resume (focused) + Start over.
    await screen.findByText(/Resume from 2:05/);
    expect(screen.getByText('▶ Start over')).toBeTruthy();

    // Select the focused "Resume" → stream starts at the saved offset.
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() =>
      expect(videoEl(container)!.getAttribute('src')).toBe('/api/v1/library/m1/stream?t=125'),
    );
  });

  it('"Start over" begins from the top and forgets the saved position', async () => {
    resumeValue = { position_sec: 125, updated_at: 1 };
    const { container } = render(
      <Player item={item} keyMap={keyMap} dispatch={vi.fn()} onExit={vi.fn()} onHome={vi.fn()} />,
    );
    await screen.findByText(/Resume from/);
    fireEvent.keyDown(window, { key: 'ArrowRight' }); // focus "Start over"
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() =>
      expect(videoEl(container)!.getAttribute('src')).toBe('/api/v1/library/m1/stream'),
    );
    // Choosing "Start over" clears the stale resume row.
    expect(deleteCount).toBe(1);
  });

  it('clears the resume position when playback finishes (ended)', async () => {
    const onExit = vi.fn();
    const { container } = render(
      <Player item={item} keyMap={keyMap} dispatch={vi.fn()} onExit={onExit} onHome={vi.fn()} />,
    );
    await waitFor(() => expect(videoEl(container)).toBeTruthy());
    fireEvent.ended(videoEl(container)!);
    expect(deleteCount).toBe(1); // resume cleared on finish
    expect(onExit).toHaveBeenCalled();
  });

  it('toggles play/pause via the play_pause action and mirrors it to control', async () => {
    const dispatch = vi.fn();
    const { container } = render(
      <Player item={item} keyMap={keyMap} dispatch={dispatch} onExit={vi.fn()} onHome={vi.fn()} />,
    );
    await waitFor(() => expect(videoEl(container)).toBeTruthy());
    fireEvent.keyDown(window, { key: ' ' }); // default play_pause binding
    expect(dispatch).toHaveBeenCalledWith('play_pause');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled(); // paused by default → plays
  });

  it('dispatches seek on left/right while playing', async () => {
    const dispatch = vi.fn();
    const { container } = render(
      <Player item={item} keyMap={keyMap} dispatch={dispatch} onExit={vi.fn()} onHome={vi.fn()} />,
    );
    await waitFor(() => expect(videoEl(container)).toBeTruthy());
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(dispatch).toHaveBeenCalledWith('seek', { delta: 10 });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(dispatch).toHaveBeenCalledWith('seek', { delta: -10 });
  });

  it('renders subtitle tracks and cycles them with Up (FR-C7)', async () => {
    subsValue = [
      { id: '0', label: 'Subtitles (en)', lang: 'en', source: 'sidecar' },
      { id: '1', label: 'English', lang: 'eng', source: 'embedded' },
    ];
    const { container } = render(
      <Player item={item} keyMap={keyMap} dispatch={vi.fn()} onExit={vi.fn()} onHome={vi.fn()} />,
    );
    await waitFor(() => expect(container.querySelectorAll('track')).toHaveLength(2));
    // Off by default.
    expect(await screen.findByText('CC: Off')).toBeTruthy();

    // Up cycles Off → first track → second → Off.
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(await screen.findByText('CC: Subtitles (en)')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(await screen.findByText('CC: English')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(await screen.findByText('CC: Off')).toBeTruthy();
  });

  it('toggles play/pause when the video is clicked (mouse)', async () => {
    const dispatch = vi.fn();
    const { container } = render(
      <Player item={item} keyMap={keyMap} dispatch={dispatch} onExit={vi.fn()} onHome={vi.fn()} />,
    );
    await waitFor(() => expect(videoEl(container)).toBeTruthy());
    fireEvent.click(videoEl(container)!);
    expect(dispatch).toHaveBeenCalledWith('play_pause');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('resumes when the Resume prompt button is clicked (mouse)', async () => {
    resumeValue = { position_sec: 125, updated_at: 1 };
    const { container } = render(
      <Player item={item} keyMap={keyMap} dispatch={vi.fn()} onExit={vi.fn()} onHome={vi.fn()} />,
    );
    await screen.findByText(/Resume from 2:05/);
    // Click "Start over" instead of arrowing to it: starts from the top and
    // clears the saved position.
    fireEvent.click(screen.getByText('▶ Start over'));
    await waitFor(() =>
      expect(videoEl(container)!.getAttribute('src')).toBe('/api/v1/library/m1/stream'),
    );
    expect(deleteCount).toBe(1);
  });

  it('Back exits and Home returns home', async () => {
    const onExit = vi.fn();
    const onHome = vi.fn();
    render(
      <Player item={item} keyMap={keyMap} dispatch={vi.fn()} onExit={onExit} onHome={onHome} />,
    );
    await waitFor(() => expect(onExit).not.toHaveBeenCalled());
    fireEvent.keyDown(window, { key: 'Escape' }); // reserved back
    expect(onExit).toHaveBeenCalled();

    onExit.mockClear();
    render(
      <Player item={item} keyMap={keyMap} dispatch={vi.fn()} onExit={onExit} onHome={onHome} />,
    );
    fireEvent.keyDown(window, { key: 'Home' }); // reserved home
    expect(onHome).toHaveBeenCalled();
  });
});
