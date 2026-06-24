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

- **`Escape` / `Backspace` on a service page** are not intercepted by this guard
  (they keep their service-defined meaning — e.g. exit fullscreen). Use **Home**
  to return. `Backspace` may trigger the browser's history-back inside a service;
  that's the service's own behavior, not OpenHearth's.
- When a service is found to need a different return key or a per-service
  `user_agent`, note the service, the symptom, and the workaround here.

## Reserved keys

`HOME_KEYS` / `BACK_KEYS` in `content.js` mirror the canonical list in
`packages/web/src/reserved.ts`. Keep them in sync. The physical "Home" button on
a typical remote/keyboard emits `Home`; some emit `BrowserHome`/`BrowserBack`.
