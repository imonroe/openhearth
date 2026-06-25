# The Home/Back Guarantee (FR-A3 / NFR-5)

> From inside a launched commercial service, the **Home** key returns to
> OpenHearth **100% of the time**. This is the single highest-risk behavioral
> requirement — "replace the box completely" depends on it.

## Architecture: two interception layers

OpenHearth launches a service by navigating the kiosk's top-level browser to the
service's own web player. Once that happens, the OpenHearth SPA is no longer
running, so interception cannot live in React alone. Two layers cover the two
situations:

1. **In-app** — while OpenHearth is the active page, `FocusProvider` handles the
   reserved Home/Back keys at the **capture phase** and calls
   `stopImmediatePropagation()`, so no in-app handler can shadow them. `home`
   returns to the home screen (resets focus to the entry tile); `back` navigates
   one level within OpenHearth (a no-op today — the SPA has only the home screen
   — but reserved and wired for the detail/settings screens in later phases).
   The canonical reserved keys live in [`packages/web/src/reserved.ts`](../packages/web/src/reserved.ts).

2. **Browser-level** — once a service page is loaded, the
   [`home-guard` extension](../scripts/kiosk/home-guard/) intercepts the same
   keys on that page (content script, `document_start`, capture phase,
   `stopImmediatePropagation`) and navigates the **top** frame back to
   OpenHearth (so a key pressed inside a service's iframe still returns the whole
   kiosk, not just the subframe). It runs before the page's later-registered
   handlers and in a separate world — the most robust mechanism short of an
   OS-level key grabber. (The isolated-world vs. a maximally adversarial
   `document_start` page ordering is not a hard spec guarantee, but the content
   script wins in practice.) The home origin and the return keys are set in
   [`home-guard/config.js`](../scripts/kiosk/home-guard/config.js).

> **The extension must actually load.** Branded Google Chrome 137+ (and Edge)
> silently ignore the `--load-extension` flag the kiosk launchers use, which
> disables this whole layer — run the kiosk on un-branded Chromium / Chrome For
> Testing, or load the unpacked extension into the persistent profile by hand.
> And the guarantee is only as good as the keys your input device sends: a
> compact Bluetooth keyboard with no Home/Back button needs its key added to
> `returnKeys` in `config.js` (use `debug: true` to discover it). See the
> deployment guides' Troubleshooting sections.

## Why not an iframe?

Embedding the service in an iframe so the OpenHearth top-level page keeps running
does not work: commercial services (Netflix, YouTube, …) send
`X-Frame-Options`/`frame-ancestors` headers that forbid framing, and key events
inside a cross-origin iframe don't reach the parent anyway. Navigating the
top-level browser + a browser-level key guard is the reliable path.

## Reserved keys

| Action | Default keys |
|---|---|
| `home` | `Home`, `BrowserHome` |
| `back` | `Backspace`, `Escape`, `BrowserBack` (in-app); `BrowserBack` (extension) |

The Home reservation is special and always available; #28 makes the other
per-action bindings fully configurable.

## Per-service quirks

Discovered quirks are recorded in the
[home-guard README](../scripts/kiosk/home-guard/README.md#per-service-quirks)
and fed back into the catalog `notes:` field. None recorded yet.

## Testing

The in-app behavior is unit-tested (`reserved.ts`, `FocusProvider`). The full
**launch → Home → home** path is the dedicated must-pass Playwright E2E in #30.
