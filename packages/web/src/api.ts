/**
 * Thin client for the server API (the seam). The web app is a pure client — it
 * imports types from `@openhearth/shared`, never from the server package.
 */
import type { Config } from '@openhearth/shared';

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
