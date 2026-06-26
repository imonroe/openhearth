# Linux kiosk auto-launch

Bring up the OpenHearth 10-foot UI fullscreen on boot on a Debian/Ubuntu-class
host (the reference target; the steps adapt to other distros). The container
serves the UI; this sets up a Chromium **kiosk** that points at it and comes up
automatically on power-on.

> The Home/Back guarantee (FR-A3 / NFR-5) on launched services depends on the
> **Home-guard extension** being loaded — the launch script below does this with
> `--load-extension`. Don't drop that flag.

## Prerequisites

- The OpenHearth server running and reachable (e.g. `docker compose up -d`),
  serving at `http://localhost:8080` (or your host/port).
- A graphical stack able to run Chromium: either a desktop environment, or a
  minimal `Xorg` + a window manager. A full desktop is **not** required.
- A Chromium-family browser, and optionally `unclutter` to hide the mouse pointer
  (`sudo apt install unclutter`). **Which browser depends on whether you stream
  DRM-protected services** (Netflix, Sling, YouTube TV, Max…):
  - **You do** → use **branded Google Chrome** and load the Home-guard by hand.
    Only branded Chrome ships Google's Widevine CDM; un-branded Chromium and
    Chrome For Testing can't decrypt those streams. See
    [Streaming DRM-protected services](#streaming-drm-protected-services) — this
    is the recommended setup for most users.
  - **You don't** (free/self-hosted content only) → un-branded Chromium
    (`sudo apt install chromium`) works with the `--load-extension` launcher as-is.
    Chrome 137+ silently ignores `--load-extension`; Chromium still honours it, so
    the script prefers `chromium`/`chromium-browser` and only falls back to
    `google-chrome`.
- This repo checked out on the box (for `scripts/kiosk/`), or just copy the
  `scripts/kiosk/` folder over.

## 1. The launch script

[`scripts/kiosk/openhearth-kiosk.sh`](../../scripts/kiosk/openhearth-kiosk.sh)
launches Chromium with the kiosk flags (fullscreen, no chrome/infobars, autoplay
allowed for the player, the Home-guard extension loaded, gesture-nav disabled)
and a dedicated persistent profile. Make it executable and test it inside a
graphical session:

```sh
chmod +x scripts/kiosk/openhearth-kiosk.sh
OPENHEARTH_URL=http://localhost:8080 scripts/kiosk/openhearth-kiosk.sh
```

Environment overrides: `OPENHEARTH_URL`, `CHROMIUM_BIN`, `OPENHEARTH_PROFILE_DIR`,
`OPENHEARTH_HOME_GUARD_DIR`.

> **If you change `OPENHEARTH_URL`** away from `http://localhost:8080`, you must
> also set `homeUrl` in [`home-guard/config.js`](../../scripts/kiosk/home-guard/config.js)
> to the same origin. If it doesn't match, the Home/Back guarantee breaks (Home
> wouldn't return, and the guard would treat the OpenHearth page itself as a
> service). `config.js` is also where you add a return key if your
> remote/keyboard's Home/Back button isn't recognized. See the
> [home-guard README](../../scripts/kiosk/home-guard/README.md) step 1.

**Cursor hiding.** Chromium's kiosk mode removes all browser chrome but does not
hide the mouse pointer. The launch script starts `unclutter -idle 0.5` when it's
installed, which hides the pointer after half a second of inactivity. (With a
D-pad/keyboard remote and no mouse, the pointer never appears anyway.)

## Streaming DRM-protected services

Netflix, Sling, YouTube TV, Max and friends are **DRM-protected** and need
Google's **Widevine** CDM to decrypt. Widevine ships **only in branded Google
Chrome** (and Edge) — **not** in un-branded Chromium or Chrome For Testing. But
branded Chrome 137+ ignores the `--load-extension` flag the launcher uses for the
Home-guard. So to get **both** DRM playback **and** the Home/Back guarantee, run
branded Chrome and load the Home-guard **once, by hand**, into the kiosk's
persistent profile:

1. If your server isn't at `http://localhost:8080`, set `homeUrl` in
   [`home-guard/config.js`](../../scripts/kiosk/home-guard/config.js) first.
2. Start branded Chrome on the kiosk profile (the launcher's `--user-data-dir`):
   ```sh
   google-chrome --user-data-dir="$HOME/.config/openhearth-kiosk"
   ```
3. Open `chrome://extensions`, enable **Developer mode** (top-right), click **Load
   unpacked**, and select the `scripts/kiosk/home-guard/` folder.
4. The extension now **persists in that profile across reboots** — the kiosk picks
   it up on every launch as long as you keep the same `--user-data-dir`. You do
   **not** need `--load-extension`, so the launcher works unchanged (the ignored
   flag is harmless); set `CHROMIUM_BIN=google-chrome` when running it.

Verify: launch a service tile, confirm DRM playback works, and press **Home** to
confirm you return to OpenHearth (that proves the unpacked Home-guard is active).

> **Caveat — this is a stopgap.** Chrome shows a "Disable developer-mode
> extensions" bubble on startup and may auto-disable the extension after some
> updates. If Home ever stops returning, re-open `chrome://extensions` and confirm
> **OpenHearth Home Guard** is still enabled. For a fully silent, update-proof
> install, package the extension as a `.crx` and force-install it via an
> enterprise policy (`ExtensionSettings` / `ExtensionInstallForcelist`); the
> durable fix is tracked in
> [ADR 0001](../adr/0001-kiosk-home-back-cdp-daemon.md).

## 2. Auto-start on boot

Pick whichever fits your host. Both assume the kiosk user **auto-logs into a
graphical session** (configure via your display manager — e.g. GDM/LightDM
"automatic login", or `raspi-config` on a Pi).

### Option A — systemd user service (recommended for a minimal box)

[`scripts/kiosk/openhearth-kiosk.service`](../../scripts/kiosk/openhearth-kiosk.service)
restarts the kiosk if Chromium is ever closed.

```sh
mkdir -p ~/.config/systemd/user
cp scripts/kiosk/openhearth-kiosk.service ~/.config/systemd/user/
# Edit ExecStart in the copied file to the absolute path of openhearth-kiosk.sh.
systemctl --user daemon-reload
systemctl --user enable --now openhearth-kiosk.service
sudo loginctl enable-linger "$USER"   # start the user session at boot
```

### Option B — XDG autostart (desktop environments)

For GNOME/KDE/LXDE and friends:

```sh
mkdir -p ~/.config/autostart
cp scripts/kiosk/openhearth-kiosk.desktop ~/.config/autostart/
# Edit Exec= in the copied file to the absolute path of openhearth-kiosk.sh.
```

### Option C — minimal `.xinitrc`

On a box with no desktop environment, launch X straight into the kiosk. In
`~/.xinitrc`:

```sh
#!/bin/sh
exec /home/USER/openhearth/scripts/kiosk/openhearth-kiosk.sh
```

…and `startx` from `~/.bash_profile` on the auto-login TTY:

```sh
if [ -z "$DISPLAY" ] && [ "$(tty)" = /dev/tty1 ]; then exec startx; fi
```

## 3. Verify

Reboot. The box should auto-login, X should start, and Chromium should come up
fullscreen on the OpenHearth home screen with no browser chrome and no pointer.
Launch a service tile and confirm the **Home** key returns to OpenHearth — that
proves the Home-guard extension loaded.

## Troubleshooting

- **Blank/again-and-again restart:** check `journalctl --user -u openhearth-kiosk`
  (Option A) — usually a wrong `ExecStart` path or `DISPLAY` not `:0`.
- **Home doesn't return from a service:** the extension didn't load — verify the
  `--load-extension` path resolves to `scripts/kiosk/home-guard`, and that
  `homeUrl` in `home-guard/config.js` matches your `OPENHEARTH_URL`. If you're
  running **branded Google Chrome** (not Chromium), Chrome 137+ ignores
  `--load-extension` — switch the kiosk to Chromium / Chrome For Testing, or load
  the extension once via `chrome://extensions` (Developer mode → Load unpacked)
  into the persistent profile. On a managed/enterprise machine, check that
  extension-install policy isn't blocking the unpacked load. See the
  [home-guard README](../../scripts/kiosk/home-guard/README.md).
- **Your remote/keyboard has no Home key:** many compact Bluetooth keyboard +
  trackpad combos don't send `Home`/`BrowserHome`/`BrowserBack`. Set
  `debug: true` in [`home-guard/config.js`](../../scripts/kiosk/home-guard/config.js),
  reload the kiosk, launch a service, press the button you want to use, and read
  the key name it logs to the browser console. Add that string to `returnKeys`
  in `config.js` and set `debug` back to `false`.
- **GPU/transcoding:** see [gpu-transcoding.md](gpu-transcoding.md) for VAAPI/QSV.
- **Auth enabled?** If you set `server.auth.token`, the bundled UI doesn't yet
  attach it to its own requests; bind the server to `127.0.0.1` for a single-box
  kiosk instead (see [config-reference.md](../config-reference.md) § Security).
