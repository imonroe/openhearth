/**
 * @openhearth/web — the "face".
 *
 * React SPA that runs in a Chromium kiosk. A pure client of the API. Imports
 * only from `@openhearth/shared` — never from `@openhearth/server`. Any import
 * from the server package is a seam violation and must fail lint.
 */
import { PROJECT_NAME } from '@openhearth/shared';

export function appTitle(): string {
  return `${PROJECT_NAME}`;
}
