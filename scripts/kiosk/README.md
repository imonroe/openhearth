# Kiosk launch scripts

Example scripts and shortcuts for launching the OpenHearth 10-foot UI in a
Chromium **kiosk** on power-on. These are references to copy and adapt — paths
and the server URL must be edited for your machine.

| File                                                   | Host    | Purpose                                                                                            |
| ------------------------------------------------------ | ------- | -------------------------------------------------------------------------------------------------- |
| [`openhearth-kiosk.sh`](openhearth-kiosk.sh)           | Linux   | Chromium kiosk launcher (fullscreen, no chrome, Home-guard loaded).                                |
| [`openhearth-kiosk.service`](openhearth-kiosk.service) | Linux   | systemd **user** service that auto-starts and restarts the kiosk.                                  |
| [`openhearth-kiosk.desktop`](openhearth-kiosk.desktop) | Linux   | XDG autostart entry for desktop environments.                                                      |
| [`openhearth-kiosk.bat`](openhearth-kiosk.bat)         | Windows | Chrome/Edge kiosk launcher for the Startup folder / Task Scheduler.                                |
| [`home-guard/`](home-guard/)                           | both    | The Chromium extension that enforces the Home/Back guarantee on launched services (FR-A3 / NFR-5). |

## Setup guides

- **Linux:** [docs/deployment/linux-kiosk.md](../../docs/deployment/linux-kiosk.md)
- **Windows:** [docs/deployment/windows-kiosk.md](../../docs/deployment/windows-kiosk.md)

> The launchers load the [`home-guard`](home-guard/) extension with
> `--load-extension`. That extension is the browser-level half of the Home/Back
> guarantee — without it, the Home key won't return from a launched service.
> Keep the flag.
>
> **Use un-branded Chromium / Chrome For Testing**, not branded Google Chrome (or
> Edge): Chrome 137+ ignores `--load-extension`, so the Home-guard never loads.
> See each deployment guide's Troubleshooting for branded-Chrome workarounds.
> Deployment settings (home URL, return keys, debug) live in
> [`home-guard/config.js`](home-guard/config.js).
