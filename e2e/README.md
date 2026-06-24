# E2E tests (Playwright)

End-to-end UI tests for the OpenHearth face (issue #30). They run the real built
app against a deterministic fixture catalog and drive it with a real browser.

## What's covered

- **`navigation.spec.ts`** — directional focus across the service grid: focus
  seats on the first tile, arrow keys move it (clamped at edges), exactly one
  element is focused at all times, and the focused tile shows the amber ring.
- **`home-back.spec.ts` — ★ must-pass (FR-A3 / NFR-5).** Launches a stubbed,
  local "commercial service" from the grid, then presses the reserved **Home**
  key and asserts the kiosk returns to the OpenHearth home screen. Because the
  React app is gone once the kiosk navigates away, this exercises the kiosk
  [`home-guard`](../scripts/kiosk/home-guard) extension — the only thing that can
  bring a launched service back. It also covers the remote's BrowserHome/
  BrowserBack keys and verifies Escape/Backspace are deliberately **not**
  hijacked (services need them). **If this regresses, the "replace the box"
  promise breaks — keep it required in branch protection.**

## How it's wired

`playwright.config.ts` starts two servers via `webServer`:

1. The built OpenHearth server (`packages/server/dist/main.js`) on **:8080**,
   serving the web bundle + API, reading the fixture config in
   `fixtures/config/` so the catalog is deterministic and offline.
2. A stub service (`fixtures/stub-service.mjs`) on **:8090** — a *different
   origin*, so the home-guard extension treats it as a foreign page and its
   Home/Back interception runs for real.

The Home/Back spec loads the unpacked `home-guard` extension via
`fixtures/extension.ts`, which needs a **headed** browser; CI wraps the run in
`xvfb-run`.

## Running locally

```sh
pnpm e2e          # builds, then runs all specs (headed; use xvfb-run on a server)
# or, against an already-built tree:
xvfb-run -a pnpm exec playwright test -c e2e/playwright.config.ts
```

The extension's return URL is hard-coded to `http://localhost:8080/` (see
`scripts/kiosk/home-guard/content.js`), which matches the server above.

## Browser version

Pinned to `@playwright/test@1.56.0` (Chromium build 1194). `pnpm exec playwright
install --with-deps chromium` provisions it in CI.
