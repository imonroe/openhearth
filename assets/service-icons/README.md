# Bundled service icons

This directory holds the **bundled streaming-service icon set** that OpenHearth
ships so the default service tiles have real logos out of the box. A service
references one with `icon: bundled:<slug>` in `services.yaml` /
`services.d/*.yaml`, where `<slug>` is the file basename here (e.g.
`bundled:netflix` → `netflix.svg`).

At runtime the server serves these from `OPENHEARTH_ICONS_DIR` (default
`/app/service-icons` in the Docker image; the Dockerfile copies this folder
there). Files render as `<img src>` under `nosniff` + a restrictive
`Content-Security-Policy`.

## Provenance & license

The icons are vendored from **[homarr-labs/dashboard-icons]**, licensed
**Apache-2.0** (full text in [`LICENSE.dashboard-icons`](LICENSE.dashboard-icons)).
Each file here was copied unmodified from that project's `svg/` directory and
renamed to match the OpenHearth service `id`:

| File (`id`)          | Upstream `svg/` source |
| -------------------- | ---------------------- |
| `netflix.svg`        | `netflix.svg`          |
| `youtube.svg`        | `youtube.svg`          |
| `youtube-tv.svg`     | `youtube-tv.svg`       |
| `disney-plus.svg`    | `disney-plus.svg`      |
| `hulu.svg`           | `hulu.svg`             |
| `max.svg`            | `max.svg`              |
| `prime-video.svg`    | `prime-video.svg`      |
| `apple-tv.svg`       | `apple-tv-plus.svg`    |
| `peacock.svg`        | `peacock.svg`          |
| `paramount-plus.svg` | `paramount-plus.svg`   |
| `spotify.svg`        | `spotify.svg`          |
| `plex.svg`           | `plex.svg`             |

The Apache-2.0 license covers the icon **files**. The logos themselves are
**trademarks of their respective owners**; bundling them here is for
service identification on the launcher only and implies no affiliation or
endorsement.

[homarr-labs/dashboard-icons]: https://github.com/homarr-labs/dashboard-icons

### Original icons (not from dashboard-icons)

These are simple, original brand-colored marks drawn for OpenHearth because
dashboard-icons has no entry for the service. They exist for service
identification on the launcher only; the names/logos remain trademarks of
their respective owners. CC0 / public-domain as far as OpenHearth is concerned —
replace any of them with your own `icon:` override at any time.

| File (`id`)    | Notes                                             |
| -------------- | ------------------------------------------------- |
| `sling-tv.svg` | Original Sling TV mark (no dashboard-icons entry) |

## Customizing

Bundled icons are the **default**, not a lock-in. To change a tile's icon,
override `icon` in your config:

```yaml
services:
  - id: netflix
    icon: my-netflix.png # a file you drop in ./config (raster: png/jpg/webp/gif)
  - id: hulu
    icon: https://example.com/hulu.png # or any http(s) URL
```

A user-supplied `icon` always wins over the bundled default. See
[`docs/config-reference.md` § Service icons](../../docs/config-reference.md) for
the full resolution order and the (raster-only) rules for config-supplied icons.

## Adding a new bundled icon

1. Drop a `<slug>.svg` (or raster) file in this directory. Keep it a plain,
   script-free image — these are served from the app origin.
2. Reference it from a service with `icon: bundled:<slug>`.
3. If it came from dashboard-icons (or another set), record its source and
   confirm the license permits redistribution.
