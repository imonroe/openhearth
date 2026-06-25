# Windows kiosk auto-launch

Bring up the OpenHearth 10-foot UI fullscreen on boot on Windows. The container
serves the UI (Docker Desktop / WSL2); this sets up Chrome (or Edge) in **kiosk**
mode pointed at it, launched automatically when the kiosk user logs in.

> The Home/Back guarantee (FR-A3 / NFR-5) on launched services depends on the
> **Home-guard extension** being loaded — the launcher below does this with
> `--load-extension`. Don't drop that flag.

## Prerequisites

- The OpenHearth server running and reachable at `http://localhost:8080` (or your
  host/port) — e.g. via Docker Desktop.
- A Chromium-family browser. **Prefer un-branded [Chromium](https://www.chromium.org/)
  or [Chrome For Testing](https://googlechromelabs.github.io/chrome-for-testing/).**
  Branded **Google Chrome 137+** (and current Edge) silently ignore the
  `--load-extension` flag the launcher uses to load the Home-guard, so the
  Home/Back guarantee won't work out of the box — see
  [Troubleshooting](#troubleshooting) for the branded-Chrome workarounds.
- This repo's `scripts\kiosk\` folder available on the machine.

## 1. The launcher

[`scripts\kiosk\openhearth-kiosk.bat`](../../scripts/kiosk/openhearth-kiosk.bat)
starts the browser with the kiosk flags (fullscreen, no chrome/infobars, autoplay
allowed for the player, the Home-guard extension loaded) using a dedicated,
persistent profile. Edit the paths at the top of the file:

- `OPENHEARTH_URL` — your server URL.
- `BROWSER` — path to `chrome.exe` (or `msedge.exe`).
- `HOME_GUARD_DIR` — defaults to the `home-guard` folder next to the script.

> **If you change `OPENHEARTH_URL`** away from `http://localhost:8080`, you must
> also set `homeUrl` in [`home-guard\config.js`](../../scripts/kiosk/home-guard/config.js)
> to the same origin, or the Home/Back guarantee breaks (the guard can't tell
> OpenHearth's own pages from a service). `config.js` is also where you add a
> return key if your remote/keyboard's Home/Back button isn't recognized. See the
> [home-guard README](../../scripts/kiosk/home-guard/README.md) step 1.

Double-click the `.bat` to test: the browser should fill the screen with the
OpenHearth home and no address bar.

**Cursor hiding.** Kiosk mode removes all browser chrome but doesn't hide the
mouse pointer. With a D-pad/keyboard remote and no mouse it never appears; if you
need it hidden with a mouse attached, use a small utility such as *AutoHideMouseCursor*
or *NoMouse*. (Windows has no built-in idle-hide.)

## 2. Auto-start on log on

Configure the kiosk user for **automatic login** first (`netplwiz` → uncheck
"Users must enter a user name and password", or set up an Assigned Access /
dedicated local account). Then pick one:

### Option A — Startup folder shortcut (simplest)

1. Press <kbd>Win</kbd>+<kbd>R</kbd>, run `shell:startup` — this opens the
   current user's Startup folder.
2. Right-click → **New → Shortcut**, and point it at the `.bat`:
   `C:\path\to\openhearth\scripts\kiosk\openhearth-kiosk.bat`
3. (Optional) In the shortcut's properties set **Run: Minimized** so the console
   window doesn't flash.

Anything in this folder runs at log on — the kiosk launches automatically.

### Option B — Task Scheduler "at log on" (more robust)

1. Open **Task Scheduler** → **Create Task**.
2. **General:** name it "OpenHearth Kiosk"; "Run only when user is logged on".
3. **Triggers:** New → "At log on" → the kiosk user.
4. **Actions:** New → Start a program → the `.bat` path above.
5. **Settings:** enable "If the task fails, restart every 1 minute" so the kiosk
   comes back if the browser is closed.

Task Scheduler survives more edge cases than the Startup folder (delayed start,
restart-on-failure) and is the recommended path for an always-on appliance.

## 3. Verify

Sign out and back in (or reboot). The browser should come up fullscreen on the
OpenHearth home with no chrome. Launch a service tile and confirm the **Home**
key returns to OpenHearth — that proves the Home-guard extension loaded.

## Troubleshooting

- **A console window flashes:** set the Startup shortcut to *Run: Minimized*
  (Option A), or run via Task Scheduler (Option B).
- **Home doesn't return from a service:** the extension didn't load. The most
  common cause on Windows is **branded Google Chrome 137+ (or Edge) ignoring
  `--load-extension`** as a security measure. Fix it one of these ways:
  1. Use un-branded **Chromium** or **Chrome For Testing** for the kiosk (set
     `BROWSER` to its `chrome.exe`) — they still honour `--load-extension`.
  2. Keep branded Chrome but load the extension once by hand into the kiosk's
     persistent profile: open `chrome://extensions`, enable **Developer mode**,
     click **Load unpacked**, and pick the `scripts\kiosk\home-guard` folder. It
     persists in the `--user-data-dir` profile across launches.
  3. As a stopgap while it still works, the launcher already passes
     `--disable-features=DisableLoadExtensionCommandLineSwitch` to re-enable the
     flag on branded builds; Google is removing that toggle, so don't rely on it.

  Also verify `HOME_GUARD_DIR` resolves to `scripts\kiosk\home-guard` and that
  `homeUrl` in `home-guard\config.js` matches your `OPENHEARTH_URL`. On a
  managed/enterprise machine, check that extension-install policy isn't blocking
  the unpacked load. See the
  [home-guard README](../../scripts/kiosk/home-guard/README.md).
- **Your remote/keyboard has no Home key:** many compact Bluetooth keyboard +
  trackpad combos don't send `Home`/`BrowserHome`/`BrowserBack`. Set
  `debug: true` in [`home-guard\config.js`](../../scripts/kiosk/home-guard/config.js),
  reload the kiosk, launch a service, press the button you want to use, and read
  the key name it logs to the browser console (`F12`). Add that string to
  `returnKeys` in `config.js` and set `debug` back to `false`. (A remote with a
  dedicated Home or Back button is the smoothest 10-foot experience.)
- **Can't reach the server:** confirm Docker Desktop is running and the port is
  published; `http://localhost:8080/api/v1/health` should return JSON.
- **Auth enabled?** If you set `server.auth.token`, the bundled UI doesn't yet
  attach it to its own requests; bind the server to `127.0.0.1` for a single-box
  kiosk instead (see [config-reference.md](../config-reference.md) § Security).
