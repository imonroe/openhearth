import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ConfigResponse } from './api';
import type { LibraryItem, LibraryListResponse, ServiceCatalog } from '@openhearth/shared';
import { App } from './App';

function libItem(over: Partial<LibraryItem>): LibraryItem {
  return {
    id: over.id ?? 'i',
    source_id: 'movies',
    kind: 'movie',
    path: '/media/movies/x.mkv',
    title: 'X',
    mtime: 1,
    indexed_at: 1,
    ...over,
  };
}

function mockLibrary(): LibraryListResponse {
  const items = [
    libItem({ id: 'm1', title: 'Arrival', year: 2016 }),
    libItem({ id: 'm2', title: 'Dune', year: 2021 }),
    libItem({ id: 'e1', kind: 'episode', title: 'The Wire', season: 1, episode: 1 }),
    libItem({ id: 'e2', kind: 'episode', title: 'The Wire', season: 1, episode: 2 }),
    libItem({ id: 'e3', kind: 'episode', title: 'The Wire', season: 2, episode: 1 }),
  ];
  return { items, total: items.length, limit: 500, offset: 0 };
}

function mockConfig(): ConfigResponse {
  return {
    valid: true,
    errors: [],
    config: {
      ui: {
        title: 'OpenHearth',
        theme: 'dark',
        rows: [
          { type: 'services', group: 'Streaming' },
          { type: 'library', source: 'movies' },
        ],
      },
      library: { sources: [{ id: 'movies', label: 'Movies', path: '/media/movies' }] },
    },
  };
}

function mockCatalog(): ServiceCatalog {
  return {
    errors: [],
    groups: [
      {
        group: 'Streaming',
        services: [
          {
            id: 'netflix',
            name: 'Netflix',
            launch_url: 'https://www.netflix.com/',
            icon: 'https://cdn/netflix.png',
            group: 'Streaming',
          },
          {
            id: 'youtube',
            name: 'YouTube',
            launch_url: 'https://www.youtube.com/tv',
            group: 'Streaming',
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const body = url.includes('/api/v1/services')
        ? mockCatalog()
        : url.includes('/api/v1/library')
          ? mockLibrary()
          : mockConfig();
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App shell', () => {
  it('fetches config + services and renders the grouped rows with service tiles', async () => {
    render(<App />);
    expect(await screen.findByText('Streaming')).toBeTruthy();
    expect(screen.getByText('Movies')).toBeTruthy();
    expect(screen.getByText('OPENHEARTH')).toBeTruthy();
    // Real service tiles render with their names.
    expect(screen.getByText('Netflix')).toBeTruthy();
    expect(screen.getByText('YouTube')).toBeTruthy();
  });

  it('renders artwork for a service with an icon and a placeholder for one without', async () => {
    const { container } = render(<App />);
    await screen.findByText('Netflix');
    // Netflix has a remote icon -> <img>.
    expect(container.querySelector('img.tile__art')).toBeTruthy();
    // YouTube has no icon -> placeholder initial 'Y'.
    const placeholders = Array.from(container.querySelectorAll('.tile__placeholder')).map(
      (el) => el.textContent,
    );
    expect(placeholders).toContain('Y');
  });

  it('falls back to a placeholder when artwork fails to load (FR-A6)', async () => {
    const { container } = render(<App />);
    await screen.findByText('Netflix');
    const img = container.querySelector('img.tile__art');
    expect(img).toBeTruthy();
    fireEvent.error(img!); // simulate a broken image
    await waitFor(() => {
      const placeholders = Array.from(container.querySelectorAll('.tile__placeholder')).map(
        (el) => el.textContent,
      );
      expect(placeholders).toContain('N'); // Netflix now shows its initial
    });
  });

  it('seats focus on the first service tile and moves it with arrow keys', async () => {
    const { container } = render(<App />);
    await screen.findByText('Netflix');

    const tilesIn = (rowIndex: number): Element[] => {
      const row = container.querySelectorAll('.row')[rowIndex];
      if (!row) throw new Error(`row ${rowIndex} not found`);
      return Array.from(row.querySelectorAll('.tile'));
    };
    const isFocused = (el: Element): boolean => el.classList.contains('is-focused');

    expect(container.querySelectorAll('.tile.is-focused')).toHaveLength(1);
    const services = tilesIn(0); // first content row = Streaming services
    expect(isFocused(services[0]!)).toBe(true); // Netflix focused

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(isFocused(services[1]!)).toBe(true); // YouTube
      expect(isFocused(services[0]!)).toBe(false);
    });

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(isFocused(tilesIn(1)[1]!)).toBe(true); // library placeholder row
    });

    expect(container.querySelectorAll('.is-focused')).toHaveLength(1);
  });

  it('applies the configured theme to the document', async () => {
    render(<App />);
    await screen.findByText('Netflix');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('launches the focused service on Enter (FR-A2)', async () => {
    const navigate = vi.fn();
    render(<App navigate={navigate} />);
    await screen.findByText('Netflix');

    // Initial focus is the first service tile (Netflix).
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://www.netflix.com/'));

    // Move to YouTube and launch it.
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://www.youtube.com/tv'));
  });

  it('does not launch when a non-service row is focused', async () => {
    const navigate = vi.fn();
    render(<App navigate={navigate} />);
    await screen.findByText('Netflix');
    // Move down to the library (placeholder) row, then Enter.
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    // Give any handler a tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('dispatches a non-focus action (play_pause) through the control path', async () => {
    const dispatch = vi.fn();
    render(<App dispatch={dispatch} />);
    await screen.findByText('Netflix');
    fireEvent.keyDown(window, { key: ' ' }); // default play_pause binding
    expect(dispatch).toHaveBeenCalledWith('play_pause', undefined);
  });

  it('browses the library row with real tiles (movies + aggregated show)', async () => {
    render(<App />);
    await screen.findByText('Netflix');
    // Movies and the aggregated show render as library tiles (FR-C2).
    expect(await screen.findByText('Arrival')).toBeTruthy();
    expect(screen.getByText('Dune')).toBeTruthy();
    expect(screen.getByText('The Wire')).toBeTruthy(); // episodes grouped into one show
  });

  // Wait until focus has actually landed on a library tile (optionally one whose
  // label matches), so we don't press Enter before the focus move has applied.
  const focusLibraryTile = async (container: HTMLElement, label?: string): Promise<void> => {
    fireEvent.keyDown(window, { key: 'ArrowDown' }); // services row -> library row
    await waitFor(() => {
      const focused = container.querySelector('.tile--library.is-focused');
      expect(focused).toBeTruthy();
      if (label) expect(focused!.textContent).toContain(label);
    });
  };

  it('opens a movie detail and starts playback via play_item (FR-C5 entry)', async () => {
    const dispatch = vi.fn();
    const { container } = render(<App dispatch={dispatch} />);
    await screen.findByText('Arrival');

    await focusLibraryTile(container, 'Arrival'); // library row col 0
    fireEvent.keyDown(window, { key: 'Enter' });
    await screen.findByText('Play');

    // Play is focused on entry; selecting it dispatches play_item for the movie.
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledWith('play_item', { id: 'm1' });
  });

  it('navigates a TV show detail by season and plays an episode', async () => {
    const dispatch = vi.fn();
    const { container } = render(<App dispatch={dispatch} />);
    await screen.findByText('Arrival');

    // Down to library, right to the "The Wire" show tile (Arrival, Dune, Wire).
    await focusLibraryTile(container);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() =>
      expect(container.querySelector('.tile--library.is-focused')!.textContent).toContain(
        'The Wire',
      ),
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    await screen.findByText('Season 1');
    expect(screen.getByText('Season 2')).toBeTruthy();

    // Move to Season 2 (live), drop into its episode list, and play it.
    fireEvent.keyDown(window, { key: 'ArrowRight' }); // focus Season 2 tab
    fireEvent.keyDown(window, { key: 'ArrowDown' }); // into episodes of season 2
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledWith('play_item', { id: 'e3' });
  });

  it('returns to home from a detail screen on Back', async () => {
    const { container } = render(<App />);
    await screen.findByText('Arrival');
    await focusLibraryTile(container, 'Arrival');
    fireEvent.keyDown(window, { key: 'Enter' });
    await screen.findByText('Play'); // movie detail
    fireEvent.keyDown(window, { key: 'Escape' }); // reserved back
    await screen.findByText('Netflix'); // home again
  });

  it('honors a remapped navigation key from config (FR-R4)', async () => {
    // Re-stub fetch with a config that remaps "right" to the "d" key.
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/services')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(mockCatalog()) });
        }
        const config = mockConfig();
        config.config.keybindings = { right: ['d'] };
        return Promise.resolve({ ok: true, json: () => Promise.resolve(config) });
      }),
    );
    const { container } = render(<App />);
    await screen.findByText('Netflix');

    const services = Array.from(container.querySelectorAll('.row')[0]!.querySelectorAll('.tile'));
    expect(services[0]!.classList.contains('is-focused')).toBe(true);
    // ArrowRight no longer moves (remapped away); "d" does.
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(services[0]!.classList.contains('is-focused')).toBe(true);
    fireEvent.keyDown(window, { key: 'd' });
    await waitFor(() => expect(services[1]!.classList.contains('is-focused')).toBe(true));
  });

  it('applies a binding remapped in-place after a config re-fetch (FR-R4 hot-reload)', async () => {
    // Start with default bindings, then have the next config fetch return a
    // remapped binding; a visibility re-fetch should swap behavior live.
    const live: { keybindings?: Record<string, string[]> } = {};
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/services')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(mockCatalog()) });
        }
        const config = mockConfig();
        config.config.keybindings = live.keybindings;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(config) });
      }),
    );

    const { container } = render(<App />);
    await screen.findByText('Netflix');
    const tile = (i: number): Element =>
      container.querySelectorAll('.row')[0]!.querySelectorAll('.tile')[i]!;

    // Initial focus is the first service tile; "d" is not bound yet (no-op).
    expect(tile(0).classList.contains('is-focused')).toBe(true);
    fireEvent.keyDown(window, { key: 'd' });
    expect(tile(0).classList.contains('is-focused')).toBe(true);

    // Hot-edit: remap "right" to "d"; trigger a config re-fetch via visibility.
    live.keybindings = { right: ['d'] };
    fireEvent(document, new Event('visibilitychange'));

    // After the re-fetch applies, "d" drives navigation to the second tile.
    await waitFor(() => {
      fireEvent.keyDown(window, { key: 'd' });
      expect(tile(1).classList.contains('is-focused')).toBe(true);
    });
  });

  // Mouse is a secondary input alongside the keyboard: hover focuses, click
  // selects — behaving exactly like focusing then pressing Enter.
  describe('mouse input', () => {
    const servicesRow = (container: HTMLElement): Element[] =>
      Array.from(container.querySelectorAll('.row')[0]!.querySelectorAll('.tile'));

    it('moves focus to a service tile on hover', async () => {
      const { container } = render(<App />);
      await screen.findByText('Netflix');
      const services = servicesRow(container);
      // Netflix (col 0) is focused on entry; hovering YouTube (col 1) moves it.
      expect(services[0]!.classList.contains('is-focused')).toBe(true);
      fireEvent.mouseEnter(services[1]!);
      await waitFor(() => {
        expect(services[1]!.classList.contains('is-focused')).toBe(true);
        expect(services[0]!.classList.contains('is-focused')).toBe(false);
      });
      // Exactly one focused element at all times (the core focus invariant).
      expect(container.querySelectorAll('.is-focused')).toHaveLength(1);
    });

    it('launches a service tile on click (FR-A2)', async () => {
      const navigate = vi.fn();
      const { container } = render(<App navigate={navigate} />);
      await screen.findByText('Netflix');
      // Click YouTube directly, without arrowing to it first.
      fireEvent.click(servicesRow(container)[1]!);
      await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://www.youtube.com/tv'));
    });

    it('opens a library item detail on click', async () => {
      const dispatch = vi.fn();
      const { container } = render(<App dispatch={dispatch} />);
      await screen.findByText('Arrival');
      const libraryTile = (label: string): Element =>
        Array.from(container.querySelectorAll('.tile--library')).find((el) =>
          el.textContent?.includes(label),
        )!;
      fireEvent.click(libraryTile('Arrival'));
      // The movie's detail screen opens; its Play CTA dispatches play_item.
      await screen.findByText('Play');
      fireEvent.click(screen.getByRole('button', { name: 'Play' }));
      expect(dispatch).toHaveBeenCalledWith('play_item', { id: 'm1' });
    });
  });
});
