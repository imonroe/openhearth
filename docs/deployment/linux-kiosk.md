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
- Chromium (`sudo apt install chromium` or `chromium-browser`), and optionally
  `unclutter` to hide the mouse pointer (`sudo apt install unclutter`).
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

**Cursor hiding.** Chromium's kiosk mode removes all browser chrome but does not
hide the mouse pointer. The launch script starts `unclutter -idle 0.5` when it's
installed, which hides the pointer after half a second of inactivity. (With a
D-pad/keyboard remote and no mouse, the pointer never appears anyway.)

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
  `--load-extension` path resolves to `scripts/kiosk/home-guard`. See the
  [home-guard README](../../scripts/kiosk/home-guard/README.md).
- **GPU/transcoding:** see [gpu-transcoding.md](gpu-transcoding.md) for VAAPI/QSV.
- **Auth enabled?** If you set `server.auth.token`, the bundled UI doesn't yet
  attach it to its own requests; bind the server to `127.0.0.1` for a single-box
  kiosk instead (see [config-reference.md](../config-reference.md) § Security).
