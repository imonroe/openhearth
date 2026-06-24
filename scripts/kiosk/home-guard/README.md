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

## How it can't be shadowed

`content.js` registers its `keydown` listener at `document_start` (before any
page script runs), in the extension's isolated world, on the **capture phase**,
and calls `stopImmediatePropagation()`. So it always runs first and the service
page's own key handlers never receive the event. A page cannot opt out.

## Install (kiosk)

1. Edit `content.js` if OpenHearth is not at `http://localhost:8080`.
2. Load the extension into the kiosk Chromium profile, either:
   - **Unpacked (dev/manual):** `chrome://extensions` → enable Developer mode →
     "Load unpacked" → select this `home-guard/` folder; or
   - **Kiosk launch flag:** start Chromium with
     `--load-extension=/path/to/scripts/kiosk/home-guard` (wired into the
     auto-launch scripts in #49).

## Per-service quirks

Some services capture or remap keys aggressively. Record anything discovered
here so it can feed back into the catalog (`notes:` field) and these docs:

- _None recorded yet._ When a service is found to need a different return key or
  a per-service `user_agent`, note the service, the symptom, and the workaround.

## Reserved keys

`HOME_KEYS` / `BACK_KEYS` in `content.js` mirror the canonical list in
`packages/web/src/reserved.ts`. Keep them in sync. The physical "Home" button on
a typical remote/keyboard emits `Home`; some emit `BrowserHome`/`BrowserBack`.
