/**
 * @openhearth/server — the "brain".
 *
 * Fastify-based service that serves the web UI bundle, the API, the WebSocket
 * control endpoint, media streaming, and ffmpeg transcoding. Imports only from
 * `@openhearth/shared` — never from `@openhearth/web`.
 */
import { PROJECT_NAME } from '@openhearth/shared';

export function banner(): string {
  return `${PROJECT_NAME} server`;
}
