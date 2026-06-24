# Host parity: Windows + Linux Docker

OpenHearth targets **co-equal Windows and Linux host support** (NFR-6). The
container image is identical on both; what differs is how the *host* maps the
three volumes, exposes ports, and (optionally) passes through a GPU. This doc
records those per-host differences and provides a **reusable test-matrix
checklist** to verify parity on each host.

> **Summary of differences:** two real ones — path mapping (bind-mount syntax +
> performance) and GPU transcoding (Linux VAAPI/QSV/NVENC vs. Windows CPU-only in
> practice). Networking/ports are the same on both (each publishes `8080`). Core
> behavior — UI, launcher, Home/Back, library, direct-play, metadata, auth — is
> identical.

## The three volumes (recap)

From the reference [`docker-compose.yml`](../../docker-compose.yml):

| Mount | Mode | Purpose |
| --- | --- | --- |
| `./config:/config` | read/write | User YAML — the **source of truth**; hot-reloaded. |
| `/path/to/media:/media` | **read-only** (`:ro`) | Library source(s). |
| `./cache:/cache` | read/write | Derived index/artwork/transcode cache — **disposable**. |

The container runs as an unprivileged user (**UID/GID 1000** by default — the
image's built-in `node` user) and serves on `8080` (`EXPOSE 8080`,
`HEALTHCHECK` → `/api/v1/health`). Override the UID/GID with the `PUID`/`PGID`
variables in `.env` (see [`.env.example`](../../.env.example)) so files written
to `config`/`cache` are owned by your host user.

## Linux Docker

- **Path mapping:** bind mounts are native and fast. Use absolute host paths (or
  paths relative to the compose file) for `config`/`cache`, and the absolute media
  path for `/media:ro`.
- **Permissions (the #1 Linux gotcha):** the container writes `config`/`cache` as
  its run-as user (**UID 1000** by default). If the host directories are owned by
  another UID, the server can't write the cache (library won't index) or seed
  config — and any files it does create end up owned by the wrong user. The fix is
  to run as your host user: set `PUID`/`PGID` in `.env` to your `id -u`/`id -g`
  (the compose file wires them into `user:`). Alternatively `sudo chown -R
  1000:1000 ./config ./cache`. `/media` is `:ro`, so its ownership only needs to be
  **readable** by the run-as user.
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
  - **Network shares / NAS (`/media` from a NAS):** see the next section — a
    **mapped drive letter does not work**; mount the SMB share directly.

### Windows: mounting `/media` from a network share (SMB/CIFS)

This is the most common Windows surprise. If your library lives on a NAS or
another PC, **do not** bind-mount a mapped drive letter:

```yaml
# WRONG — comes up empty, no error
volumes:
  - Z:/Media/Video:/media:ro
```

A mapped drive (`Z:`) only exists in your **interactive Windows login session**.
Docker Desktop runs in a WSL2 VM that never sees that mapping, so the bind mount
resolves to an empty directory and the library scan finds nothing. No
path-formatting change fixes this — the drive letter itself is the dead end.

Instead, mount the underlying SMB share as a **CIFS named volume**. Docker
connects to the share from inside the VM, independent of any Windows drive
mapping:

```yaml
services:
  openhearth:
    volumes:
      - media:/media:ro            # uses the named volume below

volumes:
  media:
    driver: local
    driver_opts:
      type: cifs
      device: '//192.168.1.223/Ian/Media/Video'   # forward slashes; UNC host + share + subpath
      o: 'addr=192.168.1.223,username=${SMB_USER},password=${SMB_PASS},ro,uid=${PUID:-1000},gid=${PGID:-1000},file_mode=0444,dir_mode=0555,vers=3.0'
```

**Finding the share path.** A mapped drive's UNC target is its `\\host\share`.
In PowerShell: `Get-SmbMapping -LocalPath 'Z:'` → e.g. `\\192.168.1.223\Ian`.
Append any subfolder and switch to forward slashes for `device:`
(`//192.168.1.223/Ian/Media/Video`).

**Credentials — the SMB variables.** Keep them in `.env` next to the compose
file (gitignored — never commit), where they fill the `${...}` placeholders
above. See [`.env.example`](../../.env.example).

| Variable | Required | Purpose |
| --- | --- | --- |
| `SMB_USER` | yes (unless guest) | Share login. `DOMAIN\user` for a domain account; just the username for a local NAS account. **No trailing spaces** — CIFS includes them in the value and auth fails intermittently. |
| `SMB_PASS` | yes (unless guest) | Password for `SMB_USER`. |
| `PUID` / `PGID` | no (default 1000) | Reused as the mount's `uid`/`gid` so the container's run-as user can read the files. |

Notes on the `o:` options:

- **`ro` + `file_mode=0444` / `dir_mode=0555`** keep the whole mount read-only,
  matching `/media`'s `:ro` contract.
- **`vers=3.0`** suits most modern NAS/Windows shares. If the mount errors, try
  `vers=2.1` or `vers=1.0` for older devices/Samba.
- **Guest shares:** if the share allows anonymous access, drop `username`/
  `password` and use `guest` instead (leave `SMB_USER`/`SMB_PASS` blank).

**Applying changes.** Docker caches volume definitions, so after editing the
options you must recreate the volume:

```sh
docker compose down
docker volume rm openhearth_media        # ignore "no such volume" the first time
docker compose up -d
docker compose exec openhearth ls -la /media   # should list your media
```

> The same CIFS named-volume approach works on **Linux** too, but there a regular
> bind mount of a locally-mounted share (e.g. via `/etc/fstab`) is usually
> simpler. The named volume is specifically the clean answer for Windows.
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
