# Host parity: Windows + Linux Docker

OpenHearth targets **co-equal Windows and Linux host support** (NFR-6). The
container image is identical on both; what differs is how the *host* maps the
three volumes, exposes ports, and (optionally) passes through a GPU. This doc
records those per-host differences and provides a **reusable test-matrix
checklist** to verify parity on each host.

> **Summary of differences:** path mapping (bind-mount syntax + performance),
> nothing in networking/ports (both publish `8080`), and GPU transcoding (Linux
> VAAPI/QSV/NVENC vs. Windows CPU-only in practice). Core behavior — UI, launcher,
> Home/Back, library, direct-play, metadata, auth — is identical.

## The three volumes (recap)

From the reference [`docker-compose.yml`](../../docker-compose.yml):

| Mount | Mode | Purpose |
| --- | --- | --- |
| `./config:/config` | read/write | User YAML — the **source of truth**; hot-reloaded. |
| `/path/to/media:/media` | **read-only** (`:ro`) | Library source(s). |
| `./cache:/cache` | read/write | Derived index/artwork/transcode cache — **disposable**. |

The container runs as the unprivileged `node` user (**UID/GID 1000**) and serves
on `8080` (`EXPOSE 8080`, `HEALTHCHECK` → `/api/v1/health`).

## Linux Docker

- **Path mapping:** bind mounts are native and fast. Use absolute host paths (or
  paths relative to the compose file) for `config`/`cache`, and the absolute media
  path for `/media:ro`.
- **Permissions (the #1 Linux gotcha):** the container writes `config`/`cache` as
  **UID 1000**. If the host directories are owned by another UID, the server can't
  write the cache (library won't index) or seed config. Fix with
  `sudo chown -R 1000:1000 ./config ./cache`, or run with a matching `user:` in
  compose. `/media` is `:ro`, so its ownership only needs to be **readable** by
  UID 1000.
- **GPU:** VAAPI/QSV via `devices: [/dev/dri:/dev/dri]` + the host `video`/`render`
  GIDs, or NVENC via the NVIDIA Container Toolkit. See
  [gpu-transcoding.md](gpu-transcoding.md).

## Windows Docker (Docker Desktop + WSL2)

- **Path mapping:** use the WSL2 backend. Two viable layouts:
  - **Best performance:** keep `config`/`cache`/media **inside the WSL2 filesystem**
    (e.g. under `\\wsl$\...` / a path in your WSL distro) and bind-mount from there.
    Cross-boundary bind mounts (`C:\...` ↔ container) work but are **noticeably
    slower** — avoid them for the cache and large media.
  - **Drive bind mounts:** `C:\Users\me\openhearth\config:/config` works via Docker
    Desktop file sharing; expect slower I/O. Use forward slashes or escaped paths in
    compose.
- **Permissions:** Docker Desktop's VM handles bind-mount ownership, so the UID-1000
  issue rarely bites — bind-mounted Windows dirs are writable by the container.
  (Named volumes for `cache` sidestep it entirely and are faster.)
- **Line endings / case:** YAML edited on Windows may carry CRLF — harmless (the
  parser tolerates it). The Windows host FS is case-insensitive; `/media` paths are
  matched case-sensitively *inside* the Linux container, so name library files
  consistently.
- **GPU:** Docker Desktop does **not** expose `/dev/dri`, so **VAAPI/QSV are
  unavailable**. NVENC via WSL2 + NVIDIA is possible but finicky and unsupported
  here. **Recommendation: leave `transcode.hwaccel: none` (CPU `libx264`) on
  Windows** — the guaranteed path. This is the documented GPU difference NFR-6
  allows.

## Networking & ports (identical)

- The UI/API/WS are published on **`http://localhost:8080`** on both hosts; the
  reference compose maps `8080:8080`. Remap on the host side if `8080` is taken
  (`ports: ["9000:8080"]`) — keep the container side `8080` so the healthcheck
  (which probes `$PORT`, default 8080) stays green.
- To reach a service on the **host** from inside the container, use
  `host.docker.internal` (works on Docker Desktop and modern Linux Docker).
- WSL2 forwards `localhost` to the host, so the kiosk browser reaches
  `localhost:8080` the same way on both. Open the host firewall only if you expose
  the UI to other LAN devices (and then consider `server.auth.token` — see
  [config-reference § Security](../config-reference.md)).

## Test matrix (run on each host)

Copy this checklist and tick it off on a Linux host and a Windows host. "Same"
means identical observable behavior (modulo the documented GPU row).

| # | Check | Linux | Windows |
| --- | --- | --- | --- |
| 1 | `docker compose up --build` builds (or `up` pulls) and the container stays healthy (`docker ps` → healthy) | ☐ | ☐ |
| 2 | `GET http://localhost:8080/api/v1/health` returns `status: ok`, `ready: true` | ☐ | ☐ |
| 3 | First run seeds `./config` from defaults; editing `openhearth.yaml` hot-reloads (no restart) | ☐ | ☐ |
| 4 | `/media` mounts read-only; the library scan indexes files (`health.library.items > 0`) | ☐ | ☐ |
| 5 | `./cache` is written (DB + artwork); deleting it and restarting rebuilds cleanly (disposable) | ☐ | ☐ |
| 6 | Web UI loads at `localhost:8080`; focus navigation works | ☐ | ☐ |
| 7 | A service tile launches its web player; **Home returns to OpenHearth** (must-pass, FR-A3) | ☐ | ☐ |
| 8 | Library browse + item detail render (with artwork when a TMDB key is set) | ☐ | ☐ |
| 9 | Direct-play of a browser-playable file works (HTTP range/seek) | ☐ | ☐ |
| 10 | Transcode path works for a non-direct file (**CPU `libx264`**) | ☐ | ☐ |
| 11 | Resume + subtitles work | ☐ | ☐ |
| 12 | No-provider degradation: with no TMDB key, library is browsable with filename titles, no errors | ☐ | ☐ |
| 13 | (Optional) `server.auth.token` set → unauthenticated API/WS rejected; health still open | ☐ | ☐ |
| 14 | Kiosk auto-launch per [windows-kiosk.md](windows-kiosk.md) / [linux-kiosk.md](linux-kiosk.md) brings up fullscreen on boot | ☐ | ☐ |
| 15 | **GPU (documented difference):** Linux may enable VAAPI/QSV/NVENC; Windows stays on CPU | n/a (opt-in) | CPU only |

## Recording findings

This document is also the **log** for host-specific quirks. When you hit a
path-mapping, permission, networking, or GPU difference not covered above, add a
dated note here so it feeds back into the docs and the catalog. Parity is
"verified" when rows 1–14 are ✓ on both hosts and row 15 matches the documented
GPU expectation.
