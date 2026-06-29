/**
 * Thin client for the server API (the seam). The web app is a pure client — it
 * imports types from `@openhearth/shared`, never from the server package.
 */
import {
  PROTOCOL_VERSION,
  type ActionName,
  type Config,
  type LibraryListResponse,
  type MediaItem,
  type PlaybackInfo,
  type ResumePosition,
  type ServiceCatalog,
  type SubtitleTrack,
  type UiSettingsPatchBody,
  type WallpaperContentType,
} from '@openhearth/shared';

export interface ConfigResponse {
  config: Config;
  errors: string[];
  valid: boolean;
}

export async function fetchConfig(signal?: AbortSignal): Promise<ConfigResponse> {
  const res = await fetch('/api/v1/config', { signal });
  if (!res.ok) {
    throw new Error(`GET /api/v1/config failed: ${res.status}`);
  }
  return (await res.json()) as ConfigResponse;
}

export async function fetchServices(signal?: AbortSignal): Promise<ServiceCatalog> {
  const res = await fetch('/api/v1/services', { signal });
  if (!res.ok) {
    throw new Error(`GET /api/v1/services failed: ${res.status}`);
  }
  return (await res.json()) as ServiceCatalog;
}

/** Fetch a library source's items (paginated; we request a generous page). */
export async function fetchLibrary(
  source: string,
  signal?: AbortSignal,
  limit = 500,
): Promise<LibraryListResponse> {
  const res = await fetch(`/api/v1/library?source=${encodeURIComponent(source)}&limit=${limit}`, {
    signal,
  });
  if (!res.ok) {
    throw new Error(`GET /api/v1/library failed: ${res.status}`);
  }
  return (await res.json()) as LibraryListResponse;
}

/** URL for an item's playable stream; `startSec` offsets a transcode (?t=). */
export function libraryStreamUrl(id: string, startSec = 0): string {
  const base = `/api/v1/library/${encodeURIComponent(id)}/stream`;
  return startSec > 0 ? `${base}?t=${Math.floor(startSec)}` : base;
}

/**
 * Fetch authoritative playback info (mode + real duration) for an item, or null
 * on failure. A transcode's `<video>.duration` is unreliable, so the OSD uses
 * this server-probed duration as the denominator instead (issue #122).
 */
export async function fetchPlaybackInfo(
  id: string,
  signal?: AbortSignal,
): Promise<PlaybackInfo | null> {
  try {
    const res = await fetch(`/api/v1/library/${encodeURIComponent(id)}/playback`, { signal });
    if (!res.ok) return null;
    return (await res.json()) as PlaybackInfo;
  } catch {
    return null;
  }
}

/**
 * Fetch rich detail metadata (overview, runtime, genres, cast, …) for an item
 * (#123), or null on failure. Resolved + cached server-side, so the detail
 * screen calls this on open and a re-open costs no provider round-trip.
 */
export async function fetchItemMetadata(
  id: string,
  signal?: AbortSignal,
): Promise<MediaItem | null> {
  try {
    const res = await fetch(`/api/v1/library/${encodeURIComponent(id)}/metadata`, { signal });
    if (!res.ok) return null;
    return (await res.json()) as MediaItem;
  } catch {
    return null;
  }
}

/** Fetch the saved resume position for an item, or null if none. */
export async function fetchResume(
  id: string,
  signal?: AbortSignal,
): Promise<ResumePosition | null> {
  const res = await fetch(`/api/v1/library/${encodeURIComponent(id)}/resume`, { signal });
  if (!res.ok) return null;
  return (await res.json()) as ResumePosition | null;
}

/** Persist the current playback position (fire-and-forget). */
export function saveResume(id: string, positionSec: number): void {
  void fetch(`/api/v1/library/${encodeURIComponent(id)}/resume`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ position_sec: Math.floor(positionSec) }),
  }).catch((err: unknown) => console.error('OpenHearth: save resume failed', err));
}

/** List an item's subtitle tracks (sidecar + embedded). Empty on failure. */
export async function fetchSubtitles(id: string, signal?: AbortSignal): Promise<SubtitleTrack[]> {
  try {
    const res = await fetch(`/api/v1/library/${encodeURIComponent(id)}/subtitles`, { signal });
    if (!res.ok) return [];
    return (await res.json()) as SubtitleTrack[];
  } catch {
    return [];
  }
}

/** URL for a subtitle track's WebVTT. */
export function subtitleTrackUrl(id: string, trackId: string): string {
  return `/api/v1/library/${encodeURIComponent(id)}/subtitles/${encodeURIComponent(trackId)}`;
}

/** Forget an item's resume position (fire-and-forget). */
export function clearResume(id: string): void {
  void fetch(`/api/v1/library/${encodeURIComponent(id)}/resume`, { method: 'DELETE' }).catch(
    (err: unknown) => console.error('OpenHearth: clear resume failed', err),
  );
}

/**
 * Persist a UI settings patch (theme, wallpaper enabled/opacity) back to the
 * config volume (#118). Returns the reloaded config so the caller can apply it
 * immediately without waiting for the next poll.
 */
export async function updateUiSettings(patch: UiSettingsPatchBody): Promise<ConfigResponse> {
  const res = await fetch('/api/v1/ui/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`PUT /api/v1/ui/settings failed: ${res.status}`);
  return (await res.json()) as ConfigResponse;
}

/** Upload a wallpaper image (base64). Returns the new config snapshot (#118). */
export async function uploadWallpaper(
  contentType: WallpaperContentType,
  dataBase64: string,
): Promise<{ image: string; config: Config }> {
  const res = await fetch('/api/v1/ui/wallpaper', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content_type: contentType, data_base64: dataBase64 }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { errors?: string[] };
      detail = body.errors?.join('; ') ?? '';
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail || `POST /api/v1/ui/wallpaper failed: ${res.status}`);
  }
  return (await res.json()) as { image: string; config: Config };
}

/** Remove the current wallpaper and clear the config (#118). */
export async function deleteWallpaper(): Promise<ConfigResponse> {
  const res = await fetch('/api/v1/ui/wallpaper', { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE /api/v1/ui/wallpaper failed: ${res.status}`);
  return (await res.json()) as ConfigResponse;
}

/**
 * URL for the current wallpaper image. The `v` param is the stored image path
 * (which carries a per-upload timestamp), so the URL changes whenever a new
 * image is uploaded — busting any cached copy.
 */
export function wallpaperUrl(image: string): string {
  return `/api/v1/ui/wallpaper?v=${encodeURIComponent(image)}`;
}

/** Resolve the artwork URL for a tile: remote URL as-is, bare filename via the
 *  server icon route, or null when there is no icon (placeholder fallback). */
export function serviceIconUrl(id: string, icon: string | undefined): string | null {
  if (!icon) return null;
  if (/^https?:\/\//i.test(icon)) return icon;
  return `/api/v1/services/${encodeURIComponent(id)}/icon`;
}

/**
 * Dispatch a control command through the same path any client uses (the REST
 * mirror). The server applies it and broadcasts `state_changed`. Fire-and-forget
 * with a logged failure — a dropped command must not break the UI.
 */
export function sendCommand(action: ActionName, params?: Record<string, unknown>): void {
  void fetch('/api/v1/control/command', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'command',
      protocol_version: PROTOCOL_VERSION,
      action,
      ...(params ? { params } : {}),
    }),
  }).catch((err: unknown) => console.error('OpenHearth: control command failed', err));
}
