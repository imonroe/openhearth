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

/** Default navigation: move the kiosk's top-level browser to `url`. */
export const defaultNavigate: Navigate = (url) => {
  window.location.assign(url);
};

/**
 * Launch a service. `launch_url` is already validated to be http(s) at the
 * catalog schema, so this never navigates to a `javascript:`/`data:` target.
 */
export function launchService(tile: ServiceTile, navigate: Navigate = defaultNavigate): void {
  if (tile.user_agent) {
    // The SPA can't override the UA for a navigation; the kiosk wrapper applies
    // it. Record the intent so it's visible in logs / future kiosk integration.
    console.info(
      `OpenHearth: launching "${tile.name}" with user_agent hint (applied by the kiosk launcher): ${tile.user_agent}`,
    );
  }
  navigate(tile.launch_url);
}
