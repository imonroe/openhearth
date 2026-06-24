# OpenHearth

A Docker-native, self-hosted **streaming hub** with a TV-optimized 10-foot UI.
Think of it as a Roku/Fire TV-style home screen that you own end to end —
ad-free, fully configurable, and with no telemetry or phone-home.

OpenHearth does three things:

- **Launches** commercial streaming services (Netflix, YouTube, Disney+, …) in a
  full-screen kiosk, the way a TV box would.
- **Plays** your own local or self-hosted media, transcoding on the fly with
  ffmpeg when your browser can't play a file directly.
- **Decorates** your library with artwork and metadata from TMDB (optional, using
  your own API key) — and works perfectly fine without it.

It runs in a single Docker container and is driven with a D-pad / arrow keys, so a
cheap mini-PC or a spare laptop wired to your TV becomes a clean, open-source set-top box.

> **Looking to contribute or build from source?** See
> [**DEVELOPER.md**](DEVELOPER.md) for the monorepo layout, architecture, build
> commands, and CI.

---

## What you need

- A machine to run the container (any host with **Docker** + **Docker Compose** —
  a mini-PC, NUC, old laptop, or home server).
- A TV or monitor for that machine, plus a way to send arrow-key / Enter input
  (a keyboard, an air-mouse remote, or an HDMI-CEC remote that emulates one).
- Optionally, a folder of your own media files and a free
  [TMDB API key](https://www.themoviedb.org/settings/api) for artwork.

You do **not** need accounts configured up front — OpenHearth boots with a
sensible default home screen and you customize it from there.

---

## Get it running

### 1. Grab the compose file

Download [`docker-compose.yml`](docker-compose.yml) (and, on Linux,
[`.env.example`](.env.example)) into an empty folder. The compose file pulls the
published image — you don't need to clone the repo.

### 2. Point it at your media

Edit the `volumes:` section so the `/media` mount points at your library folder:

```yaml
volumes:
  - ./config:/config # your settings (created on first run; source of truth)
  - /path/to/your/media:/media:ro # your library, mounted read-only
  - ./cache:/cache # derived index/artwork/transcode cache (disposable)
```

If you have no local media yet, you can leave the `/media` line as-is — the
launcher half of OpenHearth still works.

**On Linux**, copy `.env.example` to `.env` and set `PUID`/`PGID` to your own user
(`id -u` / `id -g`) so files written to `./config` and `./cache` are owned by you
instead of root:

```sh
cp .env.example .env
# then edit PUID / PGID
```

### 3. Start it

```sh
docker compose up
```

On first run OpenHearth **seeds `./config`** with working defaults (a starter
service catalog and `openhearth.yaml`), so there's something to look at
immediately. Open **<http://localhost:8080>** in a browser and you should see the
home screen. (A quick health check: `GET /api/v1/health` returns
`{ "status": "ok", "ready": true }`.)

That's it for a basic install. The next sections cover making it your own and
turning it into a real TV experience.

---

## Configure it

All settings live in editable YAML under `./config` — that folder is the **source
of truth**. Edits are **hot-reloaded**, so you don't restart the container after a
change. A bad edit never crashes the UI: the server validates on load, keeps the
last-good config, and shows a non-fatal banner.

The main file is `config/openhearth.yaml`. The
[**Configuration Reference**](docs/config-reference.md) documents every option;
the essentials are below.

### Choose which services appear (the launcher)

Service tiles come from `config/services.yaml` plus drop-in files in
`config/services.d/`. The first-run seed already ships a curated **community
catalog** — Netflix and YouTube in the main file, plus drop-ins for Disney+, Max,
Prime Video, Hulu, Apple TV, Paramount+, Peacock, Spotify, Sling, and YouTube TV.

Each tile is declarative. To add your own service, drop a file like
`config/services.d/mything.yaml`:

```yaml
services:
  - id: my-service
    name: My Service
    launch_url: https://example.com/tv
    icon: bundled:netflix # a shipped logo, a config/ file, or an http(s) URL
    group: Streaming # must match a row in openhearth.yaml -> ui.rows
    order: 40 # tiles sort by this within a group
```

Delete a tile you don't want by removing (or not seeding) its file. See
[config-reference § The community catalog](docs/config-reference.md#the-community-catalog-servicesd)
for every field and the available bundled icons.

### Arrange the home screen

`ui.rows` in `openhearth.yaml` is the ordered list of rows on the home screen.
Each `services` row shows all tiles in a matching `group`; each `library` row
shows a media source:

```yaml
ui:
  theme: dark # dark | light
  rows:
    - { type: services, group: Streaming }
    - { type: services, group: Live TV }
    - { type: library, source: movies }
    - { type: library, source: tv }
```

A service tile only renders if its `group` has a row here — that's how you hide a
whole category.

### Add your local media

Point OpenHearth at folders inside the `/media` mount under `library.sources`:

```yaml
library:
  sources:
    - id: movies
      label: Movies
      path: /media/movies # a path inside the read-only /media mount
      kind: movies # movies | tv | music | mixed
    - id: tv
      label: TV
      path: /media/tv
      kind: tv
```

The `path` is the path **inside the container** — i.e. under `/media`, which maps
to whatever host folder you set in the compose `volumes:` block. OpenHearth scans
these folders, and each `id` you list can be surfaced with a `library` row in
`ui.rows` (above).

Browser-playable files (typically H.264/AAC MP4) stream directly; anything else
is transcoded to H.264/AAC by ffmpeg on the fly. CPU transcoding is the default
and always works — GPU acceleration is opt-in (see
[Advanced topics](#advanced-topics)).

### Add artwork (optional TMDB key)

For posters and metadata, get a free [TMDB API key](https://www.themoviedb.org/settings/api)
and provide it via the `TMDB_API_KEY` environment variable (it's wired through in
the compose file and `.env`), then enable it in `openhearth.yaml`:

```yaml
metadata:
  provider: tmdb
  language: en-US
  tmdbApiKey: ${TMDB_API_KEY} # reads the env var; never hard-code a key here
```

Without a key, OpenHearth derives titles from filenames and makes **no outbound
calls at all** — it's fully usable, just without external art.

### Remap keys

`keybindings` maps logical actions to physical keys, so you can adapt to whatever
remote or keyboard you have:

```yaml
keybindings:
  up: [ArrowUp]
  down: [ArrowDown]
  left: [ArrowLeft]
  right: [ArrowRight]
  select: [Enter]
  back: [Backspace, Escape]
  home: [Home]
  play_pause: [' ']
```

`home` is reserved — it always returns to the OpenHearth home screen, and the
kiosk intercepts it before any launched service can see it.

---

## Make it a real TV experience (kiosk mode)

Running the browser tab on a laptop is fine for testing, but the intended setup is
a **Chromium kiosk** that boots straight into OpenHearth full-screen, with the
Home/Back guard so those keys always bring you back to OpenHearth instead of
getting trapped inside a streaming service's player.

The core idea is to launch Chromium with `--kiosk --app=http://localhost:8080`
and have it auto-start on boot. Step-by-step instructions, example launch scripts,
and the Home-guard setup live in the per-host guides:

- [**Linux kiosk setup**](docs/deployment/linux-kiosk.md)
- [**Windows kiosk setup**](docs/deployment/windows-kiosk.md)

---

## Caveats & gotchas

A few things that trip people up — worth reading before you file a bug:

- **DRM-protected services stay DRM-protected.** OpenHearth _launches_ Netflix,
  Disney+, etc. in their own web players — it never touches or decrypts their
  streams. That means ad-tier ads inside those services still appear, and the
  service's own login/DRM rules apply. The "ad-free" promise is about OpenHearth
  itself and your _local_ media, not commercial catalogs.
- **Streaming resolution depends on your browser's Widevine level.** A generic
  Chromium often only has Widevine L3, which several services cap at 480p/720p.
  Getting 1080p+ from those services needs a host/browser with a Widevine L1 path
  — this is a property of your machine, not an OpenHearth setting. Each service's
  `notes:` field documents its known caveats.
- **Some services need a TV-class user agent.** YouTube, for example, uses a
  D-pad-friendly "leanback" surface at `/tv`, but some Chromium builds get served
  the desktop site unless you set a `user_agent` on the tile.
- **The cache is disposable — your config is not.** Everything under `./cache`
  (SQLite index, artwork, transcode segments) is derived and safe to delete;
  OpenHearth rebuilds it. Everything under `./config` is your source of truth.
  Back up `./config`, not `./cache`.
- **`/media` is mounted read-only.** OpenHearth never writes to your library. If
  files don't show up, check that the host path in `volumes:` is correct and
  readable by the container's user (PUID/PGID on Linux).
- **No telemetry, no phone-home.** The only outbound network call OpenHearth ever
  makes is to TMDB, and only when you've configured your own key.

---

## Documentation

| Doc                                                                                               | What's in it                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Configuration reference](docs/config-reference.md)                                               | Every `openhearth.yaml` / `services.yaml` option; first-run seeding; the community service catalog and how to extend it; security (bind address + optional shared-token auth). |
| [Linux kiosk](docs/deployment/linux-kiosk.md) · [Windows kiosk](docs/deployment/windows-kiosk.md) | Auto-launch-on-boot setup and example scripts.                                                                                                                                 |
| [GPU transcoding](docs/deployment/gpu-transcoding.md)                                             | Opt-in VAAPI / NVENC / QSV acceleration (CPU is the default).                                                                                                                  |
| [Host parity](docs/deployment/host-parity.md)                                                     | Windows vs. Linux Docker differences and a verification matrix.                                                                                                                |
| [Upgrading & images](docs/deployment/upgrading.md)                                                | Published image tags, pinning, and the upgrade path.                                                                                                                           |
| [Home/Back guarantee](docs/home-back.md)                                                          | How the reserved Home/Back interception works.                                                                                                                                 |
| [Remote-control protocol](docs/protocol.md)                                                       | The HTTP + WebSocket control contract a third-party client (e.g. a phone remote) implements against.                                                                           |
| [DEVELOPER.md](DEVELOPER.md)                                                                      | Building from source, the monorepo architecture, and contributing.                                                                                                             |

### Advanced topics

- **GPU transcoding** — CPU (`libx264`) is the default and guaranteed path. To
  offload to a GPU (VAAPI / NVENC / QSV) you map the device in compose and set
  `transcode.hwaccel` in config; full per-host setup is in
  [GPU transcoding](docs/deployment/gpu-transcoding.md).
- **Optional Jellyfin/Plex reads** — beyond plain folder scans, OpenHearth can
  read an existing Jellyfin/Plex library (read-only) via `library.integrations`.
  Folder scanning is the guaranteed path; see the
  [config reference](docs/config-reference.md).
- **Securing the bind address & shared-token auth** — see the Security section of
  the [config reference](docs/config-reference.md).
- **Pinning a specific image version & upgrading** —
  [Upgrading & images](docs/deployment/upgrading.md).

---

## License

See [LICENSE](LICENSE).
