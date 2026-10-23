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
import { useCallback, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  SLIDESHOW_DEFAULT_INTERVAL_SECONDS,
  SLIDESHOW_DEFAULT_ORDER,
  SLIDESHOW_DEFAULT_TRANSITION,
  type Config,
  type ScreensaverType,
  type SlideshowImageContentType,
  type SlideshowOrder,
  type SlideshowTransition,
  type WallpaperContentType,
} from '@openhearth/shared';
import { FocusProvider, useFocus } from '../focus/FocusProvider';
import type { FocusPosition } from '../focus/focusEngine';
import type { KeyMap } from '../keybindings';
import {
  updateUiSettings,
  uploadWallpaper,
  deleteWallpaper,
  uploadSlideshowPhoto,
  deleteSlideshowPhoto,
  slideshowImageUrl,
} from '../api';
import { SCREENSAVER_LIST, resolveScreensaver } from '../screensaver/screensavers';
import { TRANSITION_LIST } from '../slideshow/transitions';
import { useSlideshowManifest } from '../slideshow/useSlideshowManifest';
import './settings.css';

/** A resolved wallpaper layer: the image URL and its opacity (#118). */
export interface WallpaperView {
  url: string;
  opacity: number;
}

/** Opacity presets offered in the Appearance panel (100% → 20%). */
const OPACITY_PRESETS = [1, 0.8, 0.6, 0.4, 0.2] as const;

/** Idle-timeout presets for the screensaver, in minutes (#126). */
const TIMEOUT_PRESETS = [1, 3, 5, 10, 15, 30] as const;

/** Per-image interval presets for the slideshow, in seconds (#164). */
const INTERVAL_PRESETS = [5, 8, 15, 30, 60] as const;

/** Order options for the slideshow (#164). */
const ORDER_OPTIONS: readonly SlideshowOrder[] = ['sequential', 'shuffle'];

/** Mirrors the server cap (20 MiB) so oversized files fail fast, client-side. */
const MAX_WALLPAPER_BYTES = 20 * 1024 * 1024;
const MAX_SLIDESHOW_IMAGE_BYTES = 20 * 1024 * 1024;

const MIME_TO_TYPE: Record<string, WallpaperContentType> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/webp': 'image/webp',
};

/** Slideshow accepts GIF too (raster only, no SVG). */
const SLIDESHOW_MIME_TO_TYPE: Record<string, SlideshowImageContentType> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
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

// Focus grid: one cell per interactive control, top to bottom. The final rows
// are the slideshow section (#164); the photo-thumbnail row length is dynamic
// (the number of uploaded photos), so the grid is built inside the component.
//   row 0:  theme toggle
//   row 1:  wallpaper enable toggle
//   row 2:  [choose/replace image] [remove]
//   row 3:  opacity presets
//   row 4:  screensaver enable toggle
//   row 5:  screensaver picker
//   row 6:  idle-timeout presets
//   row 7:  slideshow "use as screensaver" toggle
//   row 8:  slideshow interval presets
//   row 9:  slideshow transition picker
//   row 10: slideshow order (sequential | shuffle)
//   row 11: [add photo…]
//   row 12: uploaded-photo thumbnails (delete on select) — length = uploaded count
//   row 13: done
const ROW = {
  THEME: 0,
  WP_ENABLE: 1,
  WP_IMAGE: 2,
  WP_OPACITY: 3,
  SS_ENABLE: 4,
  SS_STYLE: 5,
  SS_TIMEOUT: 6,
  SL_SAVER: 7,
  SL_INTERVAL: 8,
  SL_TRANSITION: 9,
  SL_ORDER: 10,
  SL_ADD: 11,
  SL_PHOTOS: 12,
  DONE: 13,
} as const;

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
  const photoInputRef = useRef<HTMLInputElement>(null);

  const theme = config.ui?.theme ?? 'dark';
  const wp = config.ui?.wallpaper;
  const wpEnabled = wp?.enabled ?? false;
  const wpOpacity = wp?.opacity ?? 1;
  const hasImage = Boolean(wp?.image);

  // Screensaver settings, with defaults applied (#126).
  const ss = resolveScreensaver(config.ui?.screensaver);

  // Slideshow settings, with defaults applied (#164).
  const sl = config.ui?.slideshow;
  const slUseAsSaver = sl?.useAsScreensaver ?? false;
  const slInterval = sl?.intervalSeconds ?? SLIDESHOW_DEFAULT_INTERVAL_SECONDS;
  const slTransition = sl?.transition ?? SLIDESHOW_DEFAULT_TRANSITION;
  const slOrder = sl?.order ?? SLIDESHOW_DEFAULT_ORDER;

  // Uploaded photos, so the panel can show/delete them (#164). Folder-sourced
  // images aren't listed here — those are managed on the host, not the UI.
  const { manifest, reload: reloadManifest } = useSlideshowManifest();
  const uploadedPhotos = useMemo(
    () => manifest.images.filter((i) => i.uploaded),
    [manifest.images],
  );

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

  const toggleScreensaver = useCallback(() => {
    run(async () => (await updateUiSettings({ screensaver: { enabled: !ss.enabled } })).config);
  }, [run, ss.enabled]);

  const setScreensaverType = useCallback(
    (type: ScreensaverType) => {
      run(async () => (await updateUiSettings({ screensaver: { type } })).config);
    },
    [run],
  );

  const setScreensaverTimeout = useCallback(
    (minutes: number) => {
      run(
        async () => (await updateUiSettings({ screensaver: { timeoutMinutes: minutes } })).config,
      );
    },
    [run],
  );

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

  // --- slideshow (#164) -------------------------------------------------
  const toggleSlideshowSaver = useCallback(() => {
    run(
      async () =>
        (await updateUiSettings({ slideshow: { useAsScreensaver: !slUseAsSaver } })).config,
    );
  }, [run, slUseAsSaver]);

  const setInterval = useCallback(
    (seconds: number) => {
      run(async () => (await updateUiSettings({ slideshow: { intervalSeconds: seconds } })).config);
    },
    [run],
  );

  const setTransition = useCallback(
    (transition: SlideshowTransition) => {
      run(async () => (await updateUiSettings({ slideshow: { transition } })).config);
    },
    [run],
  );

  const setOrder = useCallback(
    (order: SlideshowOrder) => {
      run(async () => (await updateUiSettings({ slideshow: { order } })).config);
    },
    [run],
  );

  // Photo add/delete hit the dedicated endpoints (not config), then refresh the
  // manifest. A failed op surfaces a non-fatal message like the config saves.
  const runPhoto = useCallback((fn: () => Promise<unknown>): void => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await fn();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update photos');
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  const choosePhoto = useCallback(() => photoInputRef.current?.click(), []);

  const onPhotoChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      const contentType = SLIDESHOW_MIME_TO_TYPE[file.type];
      if (!contentType) {
        setError('Please choose a PNG, JPEG, WebP, or GIF image');
        return;
      }
      if (file.size > MAX_SLIDESHOW_IMAGE_BYTES) {
        setError('Image is larger than 20 MB');
        return;
      }
      runPhoto(async () => {
        const dataBase64 = await fileToBase64(file);
        await uploadSlideshowPhoto(contentType, dataBase64);
        reloadManifest();
      });
    },
    [runPhoto, reloadManifest],
  );

  const deletePhoto = useCallback(
    (id: string) => {
      runPhoto(async () => {
        await deleteSlideshowPhoto(id);
        reloadManifest();
      });
    },
    [runPhoto, reloadManifest],
  );

  const onSelect = useCallback(
    (pos: FocusPosition) => {
      if (busy) return;
      switch (pos.row) {
        case ROW.THEME:
          toggleTheme();
          return;
        case ROW.WP_ENABLE:
          toggleWallpaper();
          return;
        case ROW.WP_IMAGE:
          if (pos.col === 0) chooseFile();
          else removeWallpaper();
          return;
        case ROW.WP_OPACITY:
          setOpacity(OPACITY_PRESETS[pos.col] ?? 1);
          return;
        case ROW.SS_ENABLE:
          toggleScreensaver();
          return;
        case ROW.SS_STYLE: {
          const saver = SCREENSAVER_LIST[pos.col];
          if (saver) setScreensaverType(saver.id);
          return;
        }
        case ROW.SS_TIMEOUT:
          setScreensaverTimeout(TIMEOUT_PRESETS[pos.col] ?? TIMEOUT_PRESETS[2]);
          return;
        case ROW.SL_SAVER:
          toggleSlideshowSaver();
          return;
        case ROW.SL_INTERVAL:
          setInterval(INTERVAL_PRESETS[pos.col] ?? SLIDESHOW_DEFAULT_INTERVAL_SECONDS);
          return;
        case ROW.SL_TRANSITION: {
          const t = TRANSITION_LIST[pos.col];
          if (t) setTransition(t.id);
          return;
        }
        case ROW.SL_ORDER:
          setOrder(ORDER_OPTIONS[pos.col] ?? SLIDESHOW_DEFAULT_ORDER);
          return;
        case ROW.SL_ADD:
          choosePhoto();
          return;
        case ROW.SL_PHOTOS: {
          const photo = uploadedPhotos[pos.col];
          if (photo) deletePhoto(photo.id);
          return;
        }
        case ROW.DONE:
          onBack();
          return;
        default:
          return;
      }
    },
    [
      busy,
      toggleTheme,
      toggleWallpaper,
      chooseFile,
      removeWallpaper,
      setOpacity,
      toggleScreensaver,
      setScreensaverType,
      setScreensaverTimeout,
      toggleSlideshowSaver,
      setInterval,
      setTransition,
      setOrder,
      choosePhoto,
      uploadedPhotos,
      deletePhoto,
      onBack,
    ],
  );

  // Focus grid, with the dynamic photo-thumbnail row (#164).
  const rowLengths = useMemo(() => {
    const lengths = new Array(ROW.DONE + 1).fill(1);
    lengths[ROW.WP_IMAGE] = 2;
    lengths[ROW.WP_OPACITY] = OPACITY_PRESETS.length;
    lengths[ROW.SS_STYLE] = SCREENSAVER_LIST.length;
    lengths[ROW.SS_TIMEOUT] = TIMEOUT_PRESETS.length;
    lengths[ROW.SL_INTERVAL] = INTERVAL_PRESETS.length;
    lengths[ROW.SL_TRANSITION] = TRANSITION_LIST.length;
    lengths[ROW.SL_ORDER] = ORDER_OPTIONS.length;
    lengths[ROW.SL_PHOTOS] = uploadedPhotos.length; // 0 → focus engine skips the row
    return lengths;
  }, [uploadedPhotos.length]);

  return (
    <FocusProvider
      rowLengths={rowLengths}
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

            <div className="settings__section-label">Screensaver</div>

            <SettingRow
              row={4}
              label="Enable screensaver"
              hint="Show a screensaver after the interface is idle"
            >
              <Toggle on={ss.enabled} />
            </SettingRow>

            <div className="settings__opacity">
              <div className="settings__opacity-label">Style</div>
              <div className="settings__presets" role="group" aria-label="Screensaver style">
                {SCREENSAVER_LIST.map((saver, col) => (
                  <PresetButton
                    key={saver.id}
                    row={5}
                    col={col}
                    label={saver.label}
                    selected={ss.type === saver.id}
                  />
                ))}
              </div>
            </div>

            <div className="settings__opacity">
              <div className="settings__opacity-label">Start after idle</div>
              <div className="settings__presets" role="group" aria-label="Screensaver idle timeout">
                {TIMEOUT_PRESETS.map((minutes, col) => (
                  <PresetButton
                    key={minutes}
                    row={6}
                    col={col}
                    label={`${minutes} min`}
                    selected={ss.timeoutMinutes === minutes}
                  />
                ))}
              </div>
            </div>

            <div className="settings__section-label">Slideshow</div>

            <SettingRow
              row={ROW.SL_SAVER}
              label="Use as screensaver"
              hint="Show your photos on idle instead of the screensaver"
            >
              <Toggle on={slUseAsSaver} />
            </SettingRow>

            <div className="settings__opacity">
              <div className="settings__opacity-label">Seconds per image</div>
              <div className="settings__presets" role="group" aria-label="Slideshow interval">
                {INTERVAL_PRESETS.map((seconds, col) => (
                  <PresetButton
                    key={seconds}
                    row={ROW.SL_INTERVAL}
                    col={col}
                    label={`${seconds}s`}
                    selected={slInterval === seconds}
                  />
                ))}
              </div>
            </div>

            <div className="settings__opacity">
              <div className="settings__opacity-label">Transition</div>
              <div className="settings__presets" role="group" aria-label="Slideshow transition">
                {TRANSITION_LIST.map((t, col) => (
                  <PresetButton
                    key={t.id}
                    row={ROW.SL_TRANSITION}
                    col={col}
                    label={t.label}
                    selected={slTransition === t.id}
                  />
                ))}
              </div>
            </div>

            <div className="settings__opacity">
              <div className="settings__opacity-label">Order</div>
              <div className="settings__presets" role="group" aria-label="Slideshow order">
                {ORDER_OPTIONS.map((o, col) => (
                  <PresetButton
                    key={o}
                    row={ROW.SL_ORDER}
                    col={col}
                    label={o === 'sequential' ? 'In order' : 'Shuffle'}
                    selected={slOrder === o}
                  />
                ))}
              </div>
            </div>

            <div className="settings__controls">
              <FocusButton row={ROW.SL_ADD} col={0} label="Add photo…" />
            </div>

            <div className="settings__photos" role="group" aria-label="Uploaded photos">
              {uploadedPhotos.length === 0 ? (
                <div className="settings__photos-empty">
                  No uploaded photos yet. Folder sources are configured in openhearth.yaml.
                </div>
              ) : (
                uploadedPhotos.map((photo, col) => (
                  <PhotoThumb key={photo.id} row={ROW.SL_PHOTOS} col={col} id={photo.id} />
                ))
              )}
            </div>

            {error ? (
              <div className="settings__error" role="alert">
                {error}
              </div>
            ) : null}

            <div className="settings__footer">
              <FocusButton row={ROW.DONE} col={0} label="Done" variant="primary" />
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

        <input
          ref={photoInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="settings__file-input settings__file-input--photo"
          onChange={onPhotoChange}
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

/** An uploaded-photo thumbnail at (row, col); selecting it removes the photo (#164). */
function PhotoThumb({ row, col, id }: { row: number; col: number; id: string }): ReactNode {
  const { isFocused, focusAt, activate } = useFocus();
  const focused = isFocused(row, col);
  // Unique, position-based name so screen readers can tell the delete buttons
  // apart (they'd otherwise all read "Remove photo").
  const label = `Remove photo ${col + 1}`;
  return (
    <button
      type="button"
      className={`settings__photo ${focused ? 'is-focused' : ''}`}
      aria-label={label}
      title={label}
      onMouseEnter={() => focusAt({ row, col })}
      onClick={() => activate({ row, col })}
    >
      <img className="settings__photo-img" src={slideshowImageUrl(id)} alt="" draggable={false} />
      <span className="settings__photo-remove" aria-hidden="true">
        ×
      </span>
    </button>
  );
}
