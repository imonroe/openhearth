/**
 * Thin client for the server API (the seam). The web app is a pure client — it
 * imports types from `@openhearth/shared`, never from the server package.
 */
import type { Config, ServiceCatalog } from '@openhearth/shared';

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
