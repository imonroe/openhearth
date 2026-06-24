/**
 * Thin client for the server API (the seam). The web app is a pure client — it
 * imports types from `@openhearth/shared`, never from the server package.
 */
import {
  PROTOCOL_VERSION,
  type ActionName,
  type Config,
  type ServiceCatalog,
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
