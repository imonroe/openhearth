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

function videoEl(container: HTMLElement): HTMLVideoElement | null {
  return container.querySelector('video');
}

beforeEach(() => {
  resumeValue = null;
  putBodies = [];
  // jsdom doesn't implement media playback — stub the methods we call.
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, opts?: { method?: string; body?: string }) => {
      if (url.includes('/resume')) {
        if (opts?.method === 'PUT' && opts.body) putBodies.push(opts.body);
        const body = opts?.method ? { status: 'ok' } : resumeValue;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
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

  it('"Start over" begins from the top despite a saved position', async () => {
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
