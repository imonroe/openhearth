# OpenHearth Home Guard (kiosk extension)

The **single most important behavioral guarantee**: from inside any launched
commercial service, the **Home** key always returns to OpenHearth (FR-A3 /
NFR-5). This Chromium extension is the browser-level half of that guarantee.

## Why an extension is required

OpenHearth launches a service by navigating the kiosk's top-level browser to the
service's own web player (e.g. `https://www.netflix.com/`). At that point the
OpenHearth SPA is **no longer loaded**, so it cannot intercept keys. Only a
mechanism that lives _outside_ the page — a browser extension or an OS-level key
grabber — can capture the Home key on the service's page and bring the user back.

There are two interception layers, and both must exist:

| Layer                                                     | Where               | Handles                                       |
| --------------------------------------------------------- | ------------------- | --------------------------------------------- |
| In-app (`packages/web/src/reserved.ts` + `FocusProvider`) | OpenHearth SPA      | Home/Back while OpenHearth is the active page |
| **This extension**                                        | Chromium, all pages | Home/Back **on a launched service page**      |

## How it intercepts before the page

`content.js` registers its `keydown` listener at `document_start` (before the
page's own scripts run), in the extension's isolated world, on the **capture
phase**, and calls `stopImmediatePropagation()`. So it runs before the page's
later-registered handlers and they never receive the event. It runs in **every
frame** (`all_frames`) and always navigates the **top** window — so a Home press
while focus sits inside a service's iframe still returns the whole kiosk to
OpenHearth, not just that subframe.

(Strictly, the ordering between an isolated-world `document_start` listener and a
maximally adversarial page that registers its own `document_start` capture
listener is not a hard spec guarantee — but in practice the content script wins,
and this is the most robust mechanism available short of an OS-level key grabber.)

### Back keys

Only `Home`/`BrowserHome` (and `BrowserBack` as a convenience) return to
OpenHearth from a service page. `Escape` and `Backspace` are **deliberately not**
hijacked here — services use them for fullscreen/overlays — so they remain
in-app navigation only.

## Configure

All deployment settings live in [`config.js`](config.js) — you never edit
`content.js`. It exposes three values:

- `homeUrl` — the origin OpenHearth is served from. Must match `OPENHEARTH_URL`
  in the launch script. (Default `http://localhost:8080/`.)
- `returnKeys` — the `KeyboardEvent.key` values that return to OpenHearth from a
  service page. Default `['Home', 'BrowserHome', 'BrowserBack']`. Add your
  device's key here if its Home/Back button isn't recognized (see below). Avoid
  `Escape`/`Backspace` — services use them.
- `debug` — set `true` to log every key you press on a service page to the
  console, so you can discover what your remote/keyboard emits. Leave `false` in
  production.

**No Home key on your keyboard?** Many compact Bluetooth keyboard/trackpad combos
have none of the default keys. Set `debug: true`, reload the extension, open a
service, press the button you want to use, read the logged key name from the
browser console, add it to `returnKeys`, and set `debug` back to `false`.

## Install (kiosk)

1. Edit [`config.js`](config.js) if OpenHearth is not at `http://localhost:8080`.
2. Load the extension into the kiosk Chromium profile, either:
   - **Unpacked (dev/manual):** `chrome://extensions` → enable Developer mode →
     "Load unpacked" → select this `home-guard/` folder; or
   - **Kiosk launch flag:** start Chromium with
     `--load-extension=/path/to/scripts/kiosk/home-guard` (wired into the
     auto-launch scripts).

   > **Branded Chrome 137+ ignores `--load-extension`.** Google disabled that
   > switch in branded Google Chrome (and Edge) for security. Two paths:
   >
   > - **Streaming DRM services (Netflix, Sling, YouTube TV…)?** You must use
   >   **branded Google Chrome** — only it ships the Widevine CDM; un-branded
   >   Chromium and Chrome For Testing can't decrypt those streams. Load this
   >   extension by hand (the "Unpacked" path above) into the kiosk's persistent
   >   profile; it persists across reboots. See the "Streaming DRM-protected
   >   services" recipe in
   >   [`docs/deployment/linux-kiosk.md`](../../../docs/deployment/linux-kiosk.md)
   >   / [`windows-kiosk.md`](../../../docs/deployment/windows-kiosk.md).
   > - **Free / self-hosted content only?** Un-branded **Chromium** / **Chrome For
   >   Testing** still honour `--load-extension`, so the launch scripts work as-is.
   >
   > The launch scripts also pass
   > `--disable-features=DisableLoadExtensionCommandLineSwitch` as a best-effort
   > re-enable on branded builds, but Google is removing that toggle — don't rely
   > on it.

## Per-service quirks

Some services capture or remap keys aggressively. Record anything discovered
here so it can feed back into the catalog (`notes:` field) and these docs:

- **`Escape` / `Backspace` on a service page** are not intercepted by this guard
  (they keep their service-defined meaning — e.g. exit fullscreen). Use **Home**
  to return. `Backspace` may trigger the browser's history-back inside a service;
  that's the service's own behavior, not OpenHearth's.
- When a service is found to need a different return key or a per-service
  `user_agent`, note the service, the symptom, and the workaround here.

## Reserved keys

The default `returnKeys` in `config.js` mirror the canonical list in
`packages/web/src/reserved.ts` (minus `Escape`/`Backspace`, which the guard
deliberately leaves to the service). Keep the defaults in sync. The physical
"Home" button on a typical remote/keyboard emits `Home`; some emit
`BrowserHome`/`BrowserBack`; compact Bluetooth keyboards may emit none of them
(use `debug` to find out, then extend `returnKeys`).
