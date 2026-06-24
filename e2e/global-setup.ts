/**
 * Playwright global setup — generate the player E2E media fixture (#38).
 *
 * Playwright launches the `webServer` *before* globalSetup runs, so the canonical
 * place to create the fixture is the `e2e` npm script (a pre-step before
 * `playwright test`) — see e2e/generate-media-fixture.mjs. This globalSetup calls
 * the same generator as a belt-and-braces fallback for direct `playwright test`
 * invocations that bypass the npm script; it's a no-op when the fixture already
 * exists.
 */
import { generateMediaFixture } from './generate-media-fixture.mjs';

export default function globalSetup(): void {
  generateMediaFixture();
}
