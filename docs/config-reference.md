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

```yaml
server:
  port: 8080
  logLevel: info
```

### `keybindings`

A map of logical binding name → list of physical key names
([`KeyboardEvent.key`](https://developer.mozilla.org/docs/Web/API/KeyboardEvent/key/Key_Values)
values). `home` is **reserved** and always returns to the OpenHearth home screen.

| Type | Default | Notes |
|---|---|---|
| map of string → string[] | _(none)_ | Multiple keys may map to one binding. |

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

---

## `services.yaml` and `services.d/*.yaml`

The service tile catalog. A `services:` list of tile definitions; selecting a tile
navigates the kiosk to its `launch_url`. Files in `services.d/` are drop-in
definitions merged on top of `services.yaml` (the shareable community catalog).

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

> The `services.*` files are loaded as raw catalog data in Phase 1 and parsed by
> the `CatalogService` (see issue #23). The field reference above mirrors PRD
> §10.3.

---

## Validation & hot-reload

- `openhearth.yaml` is validated against the published schema on load; located,
  human-readable errors are surfaced as non-fatal banners.
- Editing a watched file applies without a restart (where the field supports it;
  `server.port` is the exception and logs a warning prompting a restart).
- On an invalid edit, the server keeps serving the **last-good** config and
  reports the error — the UI never crashes (NFR-4).
