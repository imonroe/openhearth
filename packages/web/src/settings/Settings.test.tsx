import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Config } from '@openhearth/shared';
import { Settings } from './Settings';
import { buildKeyMap } from '../keybindings';
import * as api from '../api';

vi.mock('../api', () => ({
  updateUiSettings: vi.fn(async () => ({
    config: { ui: { theme: 'light' } } as Config,
    errors: [],
    valid: true,
  })),
  uploadWallpaper: vi.fn(async () => ({
    image: 'wallpaper/background-1.png',
    config: { ui: { wallpaper: { enabled: true, image: 'wallpaper/background-1.png' } } } as Config,
  })),
  deleteWallpaper: vi.fn(async () => ({ config: { ui: {} } as Config, errors: [], valid: true })),
}));

const keyMap = buildKeyMap();
const baseConfig: Config = { ui: { theme: 'dark' } };

function renderSettings(config: Config = baseConfig) {
  const onBack = vi.fn();
  const onConfigChange = vi.fn();
  render(
    <Settings
      config={config}
      wallpaper={null}
      keyMap={keyMap}
      onConfigChange={onConfigChange}
      onBack={onBack}
    />,
  );
  return { onBack, onConfigChange };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('Settings modal (#118)', () => {
  it('renders the Appearance panel with focus on the first control', () => {
    renderSettings();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeTruthy();
    // The theme row (row 0) is focused on entry.
    expect(
      screen.getByText('Light theme').closest('.settings__row')?.classList.contains('is-focused'),
    ).toBe(true);
  });

  it('toggles the theme and lifts the returned config', async () => {
    const { onConfigChange } = renderSettings();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(api.updateUiSettings).toHaveBeenCalledWith({ theme: 'light' });
    await waitFor(() => expect(onConfigChange).toHaveBeenCalled());
  });

  it('enables the wallpaper from the second row', async () => {
    renderSettings();
    fireEvent.keyDown(window, { key: 'ArrowDown' }); // row 1: Show wallpaper
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() =>
      expect(api.updateUiSettings).toHaveBeenCalledWith({ wallpaper: { enabled: true } }),
    );
  });

  it('sets an opacity preset', async () => {
    renderSettings();
    fireEvent.keyDown(window, { key: 'ArrowDown' }); // row 1
    fireEvent.keyDown(window, { key: 'ArrowDown' }); // row 2
    fireEvent.keyDown(window, { key: 'ArrowDown' }); // row 3 (presets), col 0 = 100%
    fireEvent.keyDown(window, { key: 'ArrowRight' }); // col 1 = 80%
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() =>
      expect(api.updateUiSettings).toHaveBeenCalledWith({ wallpaper: { opacity: 0.8 } }),
    );
  });

  it('removes the wallpaper when an image is set', async () => {
    renderSettings({ ui: { wallpaper: { enabled: true, image: 'wallpaper/x.png' } } });
    fireEvent.click(screen.getByText('Remove'));
    await waitFor(() => expect(api.deleteWallpaper).toHaveBeenCalled());
  });

  it('uploads a chosen image as base64', async () => {
    renderSettings();
    const input = document.querySelector('.settings__file-input') as HTMLInputElement;
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'bg.png', {
      type: 'image/png',
    });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(api.uploadWallpaper).toHaveBeenCalled());
    const call = (api.uploadWallpaper as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[0]).toBe('image/png');
  });

  it('rejects a non-image file client-side without calling the API', () => {
    renderSettings();
    const input = document.querySelector('.settings__file-input') as HTMLInputElement;
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(api.uploadWallpaper).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/PNG, JPEG, or WebP/i);
  });

  it('toggles the screensaver (defaults on → off) from row 4 (#126)', async () => {
    renderSettings();
    for (let i = 0; i < 4; i++) fireEvent.keyDown(window, { key: 'ArrowDown' }); // → row 4
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() =>
      expect(api.updateUiSettings).toHaveBeenCalledWith({ screensaver: { enabled: false } }),
    );
  });

  it('selects the screensaver style from row 5 (#126)', async () => {
    renderSettings();
    for (let i = 0; i < 5; i++) fireEvent.keyDown(window, { key: 'ArrowDown' }); // → row 5
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() =>
      expect(api.updateUiSettings).toHaveBeenCalledWith({ screensaver: { type: 'aurora' } }),
    );
  });

  it('sets an idle-timeout preset from row 6 (#126)', async () => {
    renderSettings();
    for (let i = 0; i < 6; i++) fireEvent.keyDown(window, { key: 'ArrowDown' }); // → row 6, col 0 (1 min)
    fireEvent.keyDown(window, { key: 'ArrowRight' }); // col 1 = 3 min
    fireEvent.keyDown(window, { key: 'ArrowRight' }); // col 2 = 5 min
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() =>
      expect(api.updateUiSettings).toHaveBeenCalledWith({ screensaver: { timeoutMinutes: 5 } }),
    );
  });

  it('marks the current screensaver timeout as selected (#126)', () => {
    renderSettings({ ui: { screensaver: { timeoutMinutes: 15 } } });
    const chip = screen.getByText('15 min').closest('button');
    expect(chip?.classList.contains('is-selected')).toBe(true);
  });

  it('closes on the reserved Back key and the Done button', () => {
    const { onBack } = renderSettings();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Done'));
    expect(onBack).toHaveBeenCalledTimes(2);
  });
});
