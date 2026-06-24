import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ConfigResponse } from './api';
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

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockConfig()) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App shell', () => {
  it('fetches config and renders the configured rows', async () => {
    render(<App />);
    expect(await screen.findByText('Streaming')).toBeTruthy();
    expect(screen.getByText('Movies')).toBeTruthy();
    // Header wordmark rendered.
    expect(screen.getByText('OPENHEARTH')).toBeTruthy();
  });

  it('seats focus on the first tile and moves it with arrow keys', async () => {
    const { container } = render(<App />);
    await screen.findByText('Streaming');

    const tilesIn = (rowIndex: number): Element[] => {
      const row = container.querySelectorAll('.row')[rowIndex];
      if (!row) throw new Error(`row ${rowIndex} not found`);
      return Array.from(row.querySelectorAll('.tile'));
    };
    const isFocused = (el: Element): boolean => el.classList.contains('is-focused');

    expect(container.querySelectorAll('.tile.is-focused')).toHaveLength(1);
    // First content row, first tile is focused initially.
    const firstRowTiles = tilesIn(0);
    expect(isFocused(firstRowTiles[0]!)).toBe(true);

    // ArrowRight moves focus to the second tile in the same row.
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(isFocused(firstRowTiles[1]!)).toBe(true);
      expect(isFocused(firstRowTiles[0]!)).toBe(false);
    });

    // ArrowDown moves to the next row.
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(isFocused(tilesIn(1)[1]!)).toBe(true);
    });

    // Exactly one focused element at all times.
    expect(container.querySelectorAll('.is-focused')).toHaveLength(1);
  });

  it('applies the configured theme to the document', async () => {
    render(<App />);
    await screen.findByText('Streaming');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
