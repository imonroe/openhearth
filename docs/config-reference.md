# Configuration Reference

OpenHearth is configured entirely through host-mapped YAML under `config/`. The
files are the **source of truth**; the derived SQLite cache under `cache/` is
disposable and never hand-edited. Config is validated on load and
[hot-reloaded](#validation--hot-reload) — a bad edit never crashes the UI.

## First run: seeding `config/`

Ship-ready defaults live in [`config.example/`](../config.example). There are two
ways to get a working `config/`:

1. **Automatic (container):** on startup the server seeds an **empty or missing**
   config directory from the bundled examples. If `config/` already contains
   files, it is left untouched. (Controlled by `OPENHEARTH_SEED_DIR`, which points
   at the bundled `config.example` inside the image.)
2. **Manual:** copy the examples yourself —

   ```sh
   cp -r config.example/ config/
   ```

The reference `docker-compose.yml` mounts `./config:/config`, so either approach
persists your edits on the host.

## Directory layout

```
config/
├── openhearth.yaml     # top-level: UI, library, metadata, server, keybindings
├── services.yaml       # the service tile catalog (Strategy A)
└── services.d/         # optional drop-in service definitions (community catalog)
    ├── disney-plus.yaml
    └── spotify.yaml
```

## Secrets

API keys and other secrets are referenced from the environment using
`${VAR}` / `${VAR:-default}` interpolation and are **never committed** to YAML.
Interpolation runs on parsed string values (not raw text), so an env value can
only fill the field it appears in. Secret fields (e.g. `metadata.tmdbApiKey`) are
**redacted** (`***`) anywhere the config is returned over the API.

---

## `openhearth.yaml`

All fields are optional; an empty file is valid. Unknown keys are rejected with a
located error.

### `ui`

| Field | Type | Default | Example |
|---|---|---|---|
| `ui.title` | string | `OpenHearth` | `My Living Room` |
| `ui.theme` | `dark` \| `light` | `dark` | `dark` |
| `ui.rows` | list of [row](#ui-row) | _(none)_ | see below |

#### `ui` row

Each row renders either the service grid or a library shelf, in order.

| Field | Required | Type | Notes |
|---|---|---|---|
| `type` | yes | `services` \| `library` | What the row renders. |
| `group` | no | string | For `type: services` — which service `group` to show. |
| `source` | no | string | For `type: library` — which `library.sources[].id` to show. |

```yaml
ui:
  title: OpenHearth
  theme: dark
  rows:
    - { type: services, group: Streaming }
    - { type: library, source: movies }
```

### `library`

| Field | Type | Default | Notes |
|---|---|---|---|
| `library.sources` | list of [source](#library-source) | _(none)_ | Local-media folders to scan. |
| `library.integrations` | list of objects | `[]` | Optional read-only Jellyfin/Plex reads (a _Should_, not a _Must_). |

#### `library` source

| Field | Required | Type | Notes |
|---|---|---|---|
| `id` | yes | string | Stable id referenced by `ui.rows[].source`. |
| `label` | no | string | Display label for the shelf. |
| `path` | yes | string | Host-mapped, read-only path inside the container (e.g. `/media/movies`). |
| `kind` | no | `movies` \| `tv` \| `music` \| `mixed` | Hint for naming detection. |

```yaml
library:
  sources:
    - id: movies
      label: Movies
      path: /media/movies
      kind: movies
  integrations: []
```

### `metadata`

| Field | Type | Default | Notes |
|---|---|---|---|
| `metadata.provider` | `tmdb` | _(none)_ | The metadata provider. Optional — the app is fully usable without one. |
| `metadata.tmdbApiKey` | string | _(none)_ | TMDB key. Use `${TMDB_API_KEY}` interpolation; never commit a key. Redacted in API responses. |
| `metadata.language` | string | _(none)_ | Preferred metadata language (BCP-47), e.g. `en-US`. |

```yaml
metadata:
  provider: tmdb
  language: en-US
  # tmdbApiKey: ${TMDB_API_KEY}
```

### `server`

| Field | Type | Default | Notes |
|---|---|---|---|
| `server.port` | integer (1–65535) | `8080` | TCP port the server binds. Changing it requires a restart. |
| `server.logLevel` | `silent` \| `error` \| `warn` \| `info` \| `debug` \| `trace` | `info` | Structured-log verbosity. Hot-reloadable. |

> **Port precedence & the container healthcheck.** `server.port` (when set)
> takes precedence over the `PORT` environment variable. The bundled image's
> `HEALTHCHECK` and the reference compose port mapping target `8080`. If you set
> `server.port` to a non-default value, also update the compose `ports:` mapping
> and be aware the bundled healthcheck probes `$PORT` (default `8080`) — so a
> changed `server.port` will report the container unhealthy unless `PORT` is set
> to match. The simplest path is to leave `server.port` at `8080` and remap on
> the host side (`ports: ["9000:8080"]`).

```yaml
server:
  port: 8080
  logLevel: info
```

### `transcode`

Local-media transcoding options (Strategy C). When a file's container/codecs are
browser-playable it streams directly with HTTP range support; otherwise the
server transcodes it to H.264/AAC fragmented MP4 with ffmpeg. **CPU is the
default and the guaranteed path** — GPU acceleration is opt-in and per-host
(full setup, verification, and Windows/WSL2 caveats in
[deployment/gpu-transcoding.md](deployment/gpu-transcoding.md)).

| Field | Type | Default | Notes |
|---|---|---|---|
| `transcode.hwaccel` | `none` \| `vaapi` \| `nvenc` \| `qsv` | `none` | Hardware encoder. `none` uses libx264 (CPU). |
| `transcode.device` | path | — | Render node for VAAPI/QSV (e.g. `/dev/dri/renderD128`). |

```yaml
transcode:
  hwaccel: none
  # device: /dev/dri/renderD128
```

> The stream endpoint is `GET /api/v1/library/:id/stream`. It direct-plays with
> `Range` support (206/416) when possible, and otherwise transcodes; a `?t=<sec>`
> query starts a transcode at an offset (for resume/seek).

### `keybindings`

A map of logical binding name → list of physical key names
([`KeyboardEvent.key`](https://developer.mozilla.org/docs/Web/API/KeyboardEvent/key/Key_Values)
values). Every binding you set **replaces** that binding's default keys; bindings
you omit keep their defaults. Multiple keys may map to one binding, and each
binding maps to exactly one action in the [protocol](protocol.md) vocabulary.
Changes take effect after the config hot-reloads — no restart (FR-R4).

| Type | Default | Notes |
|---|---|---|
| map of string → string[] | the table below | Set only the bindings you want to change. |

**Default bindings:**

| Binding | Action | Default keys |
|---|---|---|
| `up` / `down` / `left` / `right` | `navigate` | `ArrowUp` / `ArrowDown` / `ArrowLeft` / `ArrowRight` |
| `select` | `select` | `Enter` |
| `play_pause` | `play_pause` | `Space` (`" "`) |
| `stop` | `stop` | _(none — bind your own)_ |
| `home` | `home` | `Home`, `BrowserHome` — **reserved** |
| `back` | `back` | `Backspace`, `Escape`, `BrowserBack` — **reserved** |

**Reserved bindings.** `home` and `back` are reserved (FR-A3 / NFR-5): `home`
always returns to the OpenHearth home screen and the kiosk intercepts the Home/Back
keys before any launched service can see them. You may **add** keys to a reserved
binding, but its default keys are always kept and cannot be reassigned to another
action — so Home/Back can never be configured into uselessness. Configuring an
unknown binding name, or two bindings that claim the same key, is non-fatal: the
UI keeps working and logs a warning (the first binding to claim a key keeps it).

In the player, `left` / `right` seek ±10s and `up` cycles subtitle tracks; on the
home/detail grids the same keys move focus — the binding is the same, the effect
is contextual.

```yaml
keybindings:
  # Override only what you want; everything else keeps its default.
  up: [ArrowUp, w]
  down: [ArrowDown, s]
  select: [Enter]
  play_pause: [' ', p]
  stop: [x]
  home: [Home, h] # adds `h`; Home/BrowserHome are always kept
```

---

## `services.yaml` and `services.d/*.yaml`

The service tile catalog. A `services:` list of tile definitions; selecting a tile
navigates the kiosk to its `launch_url`. Files in `services.d/` are drop-in
definitions merged on top of `services.yaml` (the shareable community catalog).

> **A note on field casing.** Service fields use `snake_case` (`launch_url`,
> `user_agent`) while `openhearth.yaml` uses `camelCase` (`tmdbApiKey`,
> `logLevel`). This is deliberate: service definitions follow the shareable
> community-catalog convention from PRD §10.3, so drop-in files match upstream
> examples. `launch_url` must be an `http(s)` URL.

> **Per-entry validation.** Each tile is validated by the `CatalogService`
> against the schema below. A malformed tile is reported as a non-fatal error and
> skipped — the rest of the catalog still renders. `launch_url` must be an
> `http(s)` URL and `icon` must be an `http(s)` URL or a safe relative filename
> (no scheme, not absolute, no `..`).

| Field | Required | Type | Notes |
|---|---|---|---|
| `id` | yes | string | Unique, stable identifier. |
| `name` | yes | string | Display label on the tile. |
| `launch_url` | yes | URL | Where the kiosk navigates on select. |
| `icon` | no | path/URL | Local file in `config/`, a remote URL, or omitted (metadata fallback). |
| `group` | no | string | Row/section grouping (matched by `ui.rows[].group`). |
| `order` | no | integer | Sort hint within a group. |
| `user_agent` | no | string | Optional UA override for kiosk compatibility. |
| `notes` | no | string | Human notes; ignored by the app. |

```yaml
services:
  - id: netflix
    name: Netflix
    launch_url: https://www.netflix.com/
    icon: netflix.png
    group: Streaming
    order: 10
```

> The field reference above mirrors PRD §10.3.

### The community catalog (`services.d/`)

OpenHearth ships a starter catalog so you don't have to re-author the same tiles
everyone needs. It lives in `config.example/`:

- `services.yaml` — the base tiles (Netflix, YouTube).
- `services.d/*.yaml` — one drop-in file per service (Max, Disney+, Prime Video,
  Hulu, Peacock, Paramount+, Apple TV, YouTube TV, Spotify, …).

**How merging works.** On load the server reads `services.yaml` first, then each
`services.d/*.yaml` in **filename order**. Tiles are keyed by `id`; a later
definition with the same `id` **overrides** an earlier one. So to customize a
shipped tile, drop a file later in the sort order (or edit the entry in place)
that reuses its `id`.

**Importing / extending the catalog.**

1. Copy the tiles you want from `config.example/services.yaml` and
   `config.example/services.d/` into your own `config/services.yaml` (or
   `config/services.d/`). The first-run seed already copies these for you; you
   only need to curate which tiles appear.
2. Remove the tiles you don't subscribe to — every tile in the file becomes a
   visible launcher tile.
3. Add your own: a tile is just `id` + `name` + `launch_url` (+ optional
   `icon`, `group`, `order`, `user_agent`, `notes`). Drop it in a new
   `services.d/<your-service>.yaml`.
4. Edits hot-reload — no restart needed.

**Compatibility notes (`notes`).** Each shipped entry carries a `notes` field
documenting known kiosk/DRM caveats (PRD §18) — the app ignores it, it's for
you. The recurring ones:

- **DRM is a hard wall.** Commercial services are Widevine/PlayReady-wrapped.
  OpenHearth launches their players; it can't decode them, and it can't strip
  ads inside an ad-tier plan.
- **Widevine L3.** A generic Chromium usually only has Widevine **L3**, which
  several services cap at 480p/720p. This is a property of your host browser's
  CDM, not a per-tile setting — for 1080p+ you need an L1/CDM-capable browser.
- **Kiosk detection / user agent.** A few services serve a different UI (or
  refuse) to embedded/kiosk browsers. Set `user_agent` on the tile to present a
  TV- or desktop-class UA if you get the wrong surface.
- **Regional availability.** Several tiles (Hulu, Peacock, YouTube TV) are
  region-locked or use region-specific URLs — adjust `launch_url` for yours.

---

## Validation & hot-reload

- `openhearth.yaml` is validated against the published schema on load; located,
  human-readable errors are surfaced as non-fatal banners.
- Editing a watched file applies without a restart (where the field supports it;
  `server.port` is the exception and logs a warning prompting a restart).
- On an invalid edit, the server keeps serving the **last-good** config and
  reports the error — the UI never crashes (NFR-4).
