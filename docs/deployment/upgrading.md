# Upgrading & published images

OpenHearth publishes a multi-arch container image to the GitHub Container
Registry on every tagged release (the [release workflow](../../.github/workflows/release.yml)):

- `ghcr.io/imonroe/openhearth:X.Y.Z` — an immutable, pinned version.
- `ghcr.io/imonroe/openhearth:X.Y` — the rolling latest patch of a minor line.
- `ghcr.io/imonroe/openhearth:latest` — the newest stable release (skipped for
  prereleases like `v1.0.0-rc.1`).

Images are built for **`linux/amd64` and `linux/arm64`**, so the same tag runs on
an x86 mini-PC and a Raspberry Pi 4/5 — Docker pulls the right architecture
automatically.

## Pinning vs. `latest`

The reference [`docker-compose.yml`](../../docker-compose.yml) uses `:latest` for
an easy start. For an appliance you don't want changing under you, **pin a
version**:

```yaml
services:
  openhearth:
    image: ghcr.io/imonroe/openhearth:1.0.0 # or :1.0 to follow patch releases
```

## Upgrading

```sh
docker compose pull        # fetch the new image for your tag
docker compose up -d       # recreate the container on the new image
```

(Or bump the pinned tag in `docker-compose.yml`, then `pull && up -d`.) Pulling
`:latest`/`:X.Y` gets the newer image; a pinned `:X.Y.Z` only changes when you
edit it.

### What survives an upgrade

- **`config/` (your YAML) is the source of truth and is never touched by an
  upgrade.** The config schema is **forward-compatible**: new releases only *add*
  optional fields, and an unknown/invalid key surfaces as a **non-fatal banner**
  (the server falls back to last-good config) rather than breaking — so a config
  written for an older version keeps working (FR-CFG2 / NFR-4). No manual
  migration step.
- **`cache/` is derived and disposable.** It holds the SQLite library index,
  metadata cache, and transcode artifacts — all rebuildable from
  `config` + `/media` + the provider. If a release changes the cache shape it does
  so additively; if anything ever looks stale, you can **delete `cache/` and
  restart** and it rebuilds on the next scan. Never put anything you can't lose in
  `cache/`.
- **`/media` is read-only** and untouched.

So the upgrade path is just "pull the new image and recreate the container" —
your settings carry over, and the worst-case recovery is deleting the disposable
cache.

## Verifying a release

After `up -d`, confirm the new image is healthy:

```sh
docker compose ps                         # STATUS should show "healthy"
curl -s http://localhost:8080/api/v1/health   # { "status": "ok", "ready": true, ... }
```

The `health` body also reports `protocol_version` (the
[control-protocol](../protocol.md) version) — a bump there signals a
breaking remote-control change for any third-party client (e.g. a phone remote).
