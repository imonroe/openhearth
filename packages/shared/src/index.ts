/**
 * @openhearth/shared
 *
 * The seam contract. TypeScript types and JSON Schemas for the protocol,
 * config, and media models. Imported by both `server` and `web`; imports
 * nothing from either. This is what enforces the brain/face seam at compile
 * time.
 */

/** Marketing/display name of the project. */
export const PROJECT_NAME = 'OpenHearth';

export * from './protocol/index.js';
export * from './config/index.js';
