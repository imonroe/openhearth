/**
 * Service launch (Strategy A handoff, FR-A2).
 *
 * Selecting a service tile navigates the kiosk's top-level browser to the
 * service's own web player. This is a pure launcher: it never touches or decodes
 * the stream — it just changes the page. The Home/Back interception (#26) then
 * guarantees the user can always return to OpenHearth.
 *
 * The optional per-service `user_agent` is a hint applied by the kiosk launcher
 * (Chromium `--user-agent`), not by the running SPA — a page cannot change its
 * own UA for a top-level navigation. We surface the intent for the kiosk layer
 * and for diagnostics; see docs/deployment.
 */
import type { ServiceTile } from '@openhearth/shared';

export type Navigate = (url: string) => void;

/**
 * Default navigation: move the kiosk's top-level browser to `url`.
 *
 * Uses `assign` (not `replace`) on purpose: it leaves OpenHearth in the browser
 * history. #26 owns Home/Back interception — switching this to `replace` would
 * conflict with that interceptor and break in-service navigation.
 */
export const defaultNavigate: Navigate = (url) => {
  window.location.assign(url);
};

/** http(s) guard at navigation time — defense-in-depth alongside the schema. */
function isHttpUrl(url: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Launch a service. `launch_url` is already validated to be http(s) at the
 * catalog schema; we re-check here so a non-http(s) URL can never reach the
 * navigation even if a tile slips through.
 */
export function launchService(tile: ServiceTile, navigate: Navigate = defaultNavigate): void {
  if (!isHttpUrl(tile.launch_url)) {
    console.error(
      `OpenHearth: refusing to launch "${tile.name}" — launch_url is not http(s): ${tile.launch_url}`,
    );
    return;
  }
  if (tile.user_agent) {
    // The SPA can't override the UA for a navigation; the kiosk wrapper applies
    // it. Record the intent so it's visible in logs / future kiosk integration.
    console.info(
      `OpenHearth: launching "${tile.name}" with user_agent hint (applied by the kiosk launcher): ${tile.user_agent}`,
    );
  }
  navigate(tile.launch_url);
}
