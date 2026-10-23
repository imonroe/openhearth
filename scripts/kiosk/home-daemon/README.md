# OpenHearth Home Daemon (CDP) — prototype

The durable fix for the Home/Back guarantee (FR-A3 / NFR-5), per
[ADR 0001](../../../docs/adr/0001-kiosk-home-back-cdp-daemon.md) (Approach B).

**Why this exists.** The [`home-guard` extension](../home-guard/) intercepts the
Home key _inside_ the service page. That works for most services, but an
adversarial player can defeat it — e.g. **Sling TV** hijacks `keydown` for its own
controls and the in-page content script can't reliably win. This daemon instead
grabs the reserved keys at the **OS input layer** (Linux evdev), before any page
JavaScript runs, and drives the browser over the **Chrome DevTools Protocol** to
navigate home. No web app can prevent it. And because it runs against **branded
Chrome** (which ships Widevine), DRM services keep playing — so it solves the DRM
problem and the Sling problem together.

> **Status: prototype.** Linux + the Home-returns-home core only. Not yet
> production-hardened. See "Not yet implemented" below.

## How it works

```
[remote/keyboard] --evdev--> [home-daemon.mjs] --CDP Page.navigate--> [Chrome tab]
   Home key                   (this script)        homeUrl                back to OpenHearth
```

1. Chrome runs in kiosk `--app` mode with `--remote-debugging-port` bound to
   `127.0.0.1`.
2. The daemon reads key presses from a Linux input device (`/dev/input/...`).
3. On a reserved key (Home/Back/Homepage by default), it finds the page target
   via Chrome's `/json` endpoint and sends `Page.navigate` to `homeUrl`.

## Requirements

- **Node ≥ 22** (for the built-in `WebSocket` + `fetch` globals — no `npm install`,
  zero dependencies). On Node 20/21, run with `node --experimental-websocket`.
- **Branded Google Chrome** (for Widevine/DRM), started with
  `--remote-debugging-port`. The bundled [`openhearth-kiosk-cdp.sh`](openhearth-kiosk-cdp.sh)
  does this.
- **Read access to the input device.** Add your kiosk user to the `input` group:
  `sudo usermod -aG input "$USER"` (re-login to take effect).

## Setup

1. **Find your input device.** List candidates and identify your keyboard/remote:

   ```sh
   ls -l /dev/input/by-id/        # stable names; prefer one ending in -kbd
   # or, to see what emits keys live:
   sudo evtest                    # pick the device, note its /dev/input/eventN
   ```

   Put the path in [`config.json`](config.json) (`device`), or set
   `OPENHEARTH_INPUT_DEVICE`. Prefer a `/dev/input/by-id/...` path — `eventN`
   numbers can change across reboots.

2. **Discover your remote's key codes (if Home doesn't work).** Set `"debug": true`
   in `config.json`, run the daemon, and press buttons — it logs each key code.
   Add the codes you want to `returnKeyCodes`. Defaults are `KEY_HOME` (102),
   `KEY_BACK` (158), `KEY_HOMEPAGE` (172).

3. **Run it.** Either the all-in-one launcher (starts Chrome + the daemon):
   ```sh
   chmod +x openhearth-kiosk-cdp.sh
   OPENHEARTH_URL=http://localhost:8080 ./openhearth-kiosk-cdp.sh
   ```
   …or, with Chrome already running with `--remote-debugging-port=9222`:
   ```sh
   node home-daemon.mjs
   ```

## Configuration

[`config.json`](config.json) (each key overridable by the env var in parentheses):

| Key                 | Meaning                                           | Env override               |
| ------------------- | ------------------------------------------------- | -------------------------- |
| `homeUrl`           | Where to navigate on a reserved key.              | `OPENHEARTH_HOME_URL`      |
| `cdpHost`/`cdpPort` | Chrome DevTools endpoint (keep host `127.0.0.1`). | `OPENHEARTH_CDP_HOST/PORT` |
| `device`            | Linux input device to grab.                       | `OPENHEARTH_INPUT_DEVICE`  |
| `returnKeyCodes`    | evdev key codes that return to OpenHearth.        | —                          |
| `debug`             | Log every key code seen.                          | `OPENHEARTH_DEBUG`         |

## Security note

`--remote-debugging-port` is an **unauthenticated local control surface** — anything
that can reach it can drive the browser. Chrome binds it to `127.0.0.1` by default;
keep it there and never expose it on the LAN. The launcher sets
`--remote-debugging-address=127.0.0.1` explicitly. This is the trade-off the ADR
documents for Approach B.

## Not yet implemented (prototype scope)

- **Per-service user-agent** (`Network.setUserAgentOverride`) — the ADR's fix for
  the YouTube `/tv` → desktop fallback. Needs a launch handoff from the SPA
  ("about to launch service X, set UA Y") and is the next increment.
- **Windows** key capture (a low-level keyboard hook). Linux/evdev only for now.
- **CDP reconnect resilience** beyond per-press rediscovery, and a systemd unit.
- **32-bit kernels:** the evdev record parser assumes the 64-bit 24-byte
  `input_event` layout.
