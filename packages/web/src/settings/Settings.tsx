/**
 * Settings modal (#118).
 *
 * A focus-trapped overlay that floats over the home screen. v1 has a single
 * "Appearance" category: the light/dark theme and the custom wallpaper (enable,
 * upload, opacity). The wallpaper renders behind the modal's scrim so edits
 * preview live. Every change persists immediately to the config volume via the
 * server, and the returned config is lifted back into the app so the home (and
 * this modal) reflect it without waiting for the next poll.
 *
 * Like the other overlay screens (LibraryGrid/Detail/Player) it owns a single
 * FocusProvider and replaces the home in the render tree, so there's never more
 * than one capture-phase key handler installed at a time.
 */
import { useCallback, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import type { Config, WallpaperContentType } from '@openhearth/shared';
import { FocusProvider, useFocus } from '../focus/FocusProvider';
import type { FocusPosition } from '../focus/focusEngine';
import type { KeyMap } from '../keybindings';
import { updateUiSettings, uploadWallpaper, deleteWallpaper } from '../api';
import './settings.css';

/** A resolved wallpaper layer: the image URL and its opacity (#118). */
export interface WallpaperView {
  url: string;
  opacity: number;
}

/** Opacity presets offered in the Appearance panel (100% → 20%). */
const OPACITY_PRESETS = [1, 0.8, 0.6, 0.4, 0.2] as const;

/** Mirrors the server cap (20 MiB) so oversized files fail fast, client-side. */
const MAX_WALLPAPER_BYTES = 20 * 1024 * 1024;

const MIME_TO_TYPE: Record<string, WallpaperContentType> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/webp': 'image/webp',
};

/** Read a File as base64 (no data-URL prefix) for the upload endpoint. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image file'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

// Focus grid: one cell per interactive control, top to bottom.
//   row 0: theme toggle
//   row 1: wallpaper enable toggle
//   row 2: [choose/replace image] [remove]
//   row 3: opacity presets (5)
//   row 4: done
const ROW_LENGTHS = [1, 1, 2, OPACITY_PRESETS.length, 1];

export function Settings({
  config,
  wallpaper,
  keyMap,
  onConfigChange,
  onBack,
}: {
  config: Config;
  wallpaper: WallpaperView | null;
  keyMap: KeyMap;
  onConfigChange: (config: Config) => void;
  onBack: () => void;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const theme = config.ui?.theme ?? 'dark';
  const wp = config.ui?.wallpaper;
  const wpEnabled = wp?.enabled ?? false;
  const wpOpacity = wp?.opacity ?? 1;
  const hasImage = Boolean(wp?.image);

  // Run a persisting action: lift the returned config on success, surface a
  // non-fatal message on failure. A failed save never breaks the modal.
  const run = useCallback(
    (fn: () => Promise<Config>): void => {
      setBusy(true);
      setError(null);
      void (async () => {
        try {
          onConfigChange(await fn());
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not save the change');
        } finally {
          setBusy(false);
        }
      })();
    },
    [onConfigChange],
  );

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    run(async () => (await updateUiSettings({ theme: next })).config);
  }, [run, theme]);

  const toggleWallpaper = useCallback(() => {
    run(async () => (await updateUiSettings({ wallpaper: { enabled: !wpEnabled } })).config);
  }, [run, wpEnabled]);

  const setOpacity = useCallback(
    (value: number) => {
      run(async () => (await updateUiSettings({ wallpaper: { opacity: value } })).config);
    },
    [run],
  );

  const removeWallpaper = useCallback(() => {
    run(async () => (await deleteWallpaper()).config);
  }, [run]);

  const chooseFile = useCallback(() => fileInputRef.current?.click(), []);

  const onFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = ''; // allow re-selecting the same file later
      if (!file) return;
      const contentType = MIME_TO_TYPE[file.type];
      if (!contentType) {
        setError('Please choose a PNG, JPEG, or WebP image');
        return;
      }
      if (file.size > MAX_WALLPAPER_BYTES) {
        setError('Image is larger than 20 MB');
        return;
      }
      run(async () => {
        const dataBase64 = await fileToBase64(file);
        return (await uploadWallpaper(contentType, dataBase64)).config;
      });
    },
    [run],
  );

  const onSelect = useCallback(
    (pos: FocusPosition) => {
      if (busy) return;
      switch (pos.row) {
        case 0:
          toggleTheme();
          return;
        case 1:
          toggleWallpaper();
          return;
        case 2:
          if (pos.col === 0) chooseFile();
          else removeWallpaper();
          return;
        case 3:
          setOpacity(OPACITY_PRESETS[pos.col] ?? 1);
          return;
        case 4:
          onBack();
          return;
        default:
          return;
      }
    },
    [busy, toggleTheme, toggleWallpaper, chooseFile, removeWallpaper, setOpacity, onBack],
  );

  return (
    <FocusProvider
      rowLengths={ROW_LENGTHS}
      initialPosition={{ row: 0, col: 0 }}
      keyMap={keyMap}
      onSelect={onSelect}
      onBack={onBack}
      onHome={onBack}
    >
      <div className="settings">
        {wallpaper ? (
          <div
            className="settings__wallpaper"
            aria-hidden="true"
            style={{ backgroundImage: `url("${wallpaper.url}")`, opacity: wallpaper.opacity }}
          />
        ) : null}
        <div className="settings__scrim" aria-hidden="true" />

        <div className="settings__card" role="dialog" aria-modal="true" aria-label="Settings">
          <aside className="settings__sidebar">
            <div className="settings__sidebar-title">Settings</div>
            <div className="settings__nav-item settings__nav-item--active" aria-current="page">
              <span className="settings__nav-icon" aria-hidden="true">
                ◐
              </span>
              Appearance
            </div>
          </aside>

          <section className="settings__panel" aria-label="Appearance">
            <h2 className="settings__panel-title">Appearance</h2>

            <SettingRow
              row={0}
              label="Light theme"
              hint="Switch between the dark and light palette"
            >
              <Toggle on={theme === 'light'} />
            </SettingRow>

            <div className="settings__section-label">Wallpaper</div>

            <SettingRow
              row={1}
              label="Show wallpaper"
              hint="Render a custom image behind the home screen"
            >
              <Toggle on={wpEnabled} />
            </SettingRow>

            <div className="settings__controls">
              <FocusButton row={2} col={0} label={hasImage ? 'Replace image…' : 'Choose image…'} />
              <FocusButton row={2} col={1} label="Remove" variant="ghost" muted={!hasImage} />
            </div>

            <div className="settings__opacity">
              <div className="settings__opacity-label">Opacity</div>
              <div className="settings__presets" role="group" aria-label="Wallpaper opacity">
                {OPACITY_PRESETS.map((value, col) => (
                  <PresetButton
                    key={value}
                    row={3}
                    col={col}
                    label={`${Math.round(value * 100)}%`}
                    selected={Math.abs(wpOpacity - value) < 0.001}
                  />
                ))}
              </div>
            </div>

            {error ? (
              <div className="settings__error" role="alert">
                {error}
              </div>
            ) : null}

            <div className="settings__footer">
              <FocusButton row={4} col={0} label="Done" variant="primary" />
            </div>
          </section>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="settings__file-input"
          onChange={onFileChange}
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>
    </FocusProvider>
  );
}

/** A label + hint + trailing control; the whole row is one focusable cell. */
function SettingRow({
  row,
  label,
  hint,
  children,
}: {
  row: number;
  label: string;
  hint?: string;
  children: ReactNode;
}): ReactNode {
  const { isFocused, focusAt, activate } = useFocus();
  const focused = isFocused(row, 0);
  return (
    <div
      className={`settings__row ${focused ? 'is-focused' : ''}`}
      role="button"
      tabIndex={-1}
      onMouseEnter={() => focusAt({ row, col: 0 })}
      onClick={() => activate({ row, col: 0 })}
    >
      <div className="settings__row-text">
        <div className="settings__row-label">{label}</div>
        {hint ? <div className="settings__row-hint">{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** Visual on/off switch (design-system §11). Reflects state; the row is focusable. */
function Toggle({ on }: { on: boolean }): ReactNode {
  return (
    <span className={`settings__toggle ${on ? 'is-on' : ''}`} aria-hidden="true">
      <span className="settings__toggle-knob" />
    </span>
  );
}

/** A focusable button cell at (row, col). */
function FocusButton({
  row,
  col,
  label,
  variant,
  muted,
}: {
  row: number;
  col: number;
  label: string;
  variant?: 'primary' | 'ghost';
  muted?: boolean;
}): ReactNode {
  const { isFocused, focusAt, activate } = useFocus();
  const focused = isFocused(row, col);
  const variantClass = variant ? `settings__btn--${variant}` : '';
  return (
    <button
      type="button"
      className={`settings__btn ${variantClass} ${muted ? 'is-muted' : ''} ${focused ? 'is-focused' : ''}`}
      onMouseEnter={() => focusAt({ row, col })}
      onClick={() => activate({ row, col })}
    >
      {label}
    </button>
  );
}

/** A focusable opacity-preset chip at (row, col), highlighted when current. */
function PresetButton({
  row,
  col,
  label,
  selected,
}: {
  row: number;
  col: number;
  label: string;
  selected: boolean;
}): ReactNode {
  const { isFocused, focusAt, activate } = useFocus();
  const focused = isFocused(row, col);
  return (
    <button
      type="button"
      className={`settings__preset ${selected ? 'is-selected' : ''} ${focused ? 'is-focused' : ''}`}
      aria-pressed={selected}
      onMouseEnter={() => focusAt({ row, col })}
      onClick={() => activate({ row, col })}
    >
      {label}
    </button>
  );
}
