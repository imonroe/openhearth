import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ConfigResponse } from './api';
import type { ServiceCatalog } from '@openhearth/shared';
import { App } from './App';

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
      const body = url.includes('/api/v1/services') ? mockCatalog() : mockConfig();
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
});
