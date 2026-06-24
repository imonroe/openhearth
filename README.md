# OpenHearth

A Docker-native, self-hosted **streaming hub** with a TV-optimized 10-foot UI. It
**launches** commercial streaming services (Netflix, YouTube, …) in a kiosk,
**plays** your own local/self-hosted media with on-the-fly ffmpeg transcoding, and
pulls **artwork/metadata** from TMDB — ad-free, fully configurable, no telemetry.
A Roku/Fire TV-style box you own end to end.

## Quickstart

You need [Docker](https://docs.docker.com/get-docker/) (with Compose) and a TV/
monitor whose browser will run the kiosk.

1. **Get the reference compose** ([`docker-compose.yml`](docker-compose.yml)) and
   point the media mount at your library:

   ```yaml
   volumes:
     - ./config:/config # user YAML (created on first run; the source of truth)
     - /path/to/your/media:/media:ro # your library, read-only
     - ./cache:/cache # derived index/artwork/transcode cache (disposable)
   ```

2. **Start it:**

   ```sh
   docker compose up      # add --build to build from a checkout instead of pulling
   ```

   First run **seeds `./config`** with sensible defaults (a service catalog +
   `openhearth.yaml`), so it works before you edit anything. The server comes up
   on **`http://localhost:8080`** — open it in a browser to see the home screen.
   `GET /api/v1/health` should return `{ "status": "ok", "ready": true }`.

3. **Configure** (optional): edit `config/openhearth.yaml` — add library sources,
   set a TMDB key for artwork (`TMDB_API_KEY` env or in YAML), choose a theme,
   remap keys. Changes **hot-reload**; no restart. See the
   [config reference](docs/config-reference.md).

4. **Point a kiosk at it** for the real 10-foot experience: launch Chromium in
   kiosk mode (`--kiosk --app=http://localhost:8080`) with the Home-guard
   extension, auto-starting on boot. Step-by-step for each host:
   [Linux](docs/deployment/linux-kiosk.md) · [Windows](docs/deployment/windows-kiosk.md).

The app is **fully usable with no TMDB key** (filename-derived titles, no external
art) and tolerates a missing/cold cache. Without a key it makes **no outbound
calls at all** (NFR-9).

## Documentation

| Doc                                                                                               | What's in it                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Config reference](docs/config-reference.md)                                                      | Every `openhearth.yaml` / `services.yaml` option; first-run seeding; **the community service catalog** (`services.d/`) and how to extend it; the Security section (bind address + optional shared-token auth). |
| [Remote-control protocol](docs/protocol.md)                                                       | The frozen v1 HTTP + WebSocket control contract a third-party client (e.g. a phone remote) implements against.                                                                                                 |
| [Linux kiosk](docs/deployment/linux-kiosk.md) · [Windows kiosk](docs/deployment/windows-kiosk.md) | Auto-launch-on-boot setup + example scripts ([`scripts/kiosk/`](scripts/kiosk/)).                                                                                                                              |
| [GPU transcoding](docs/deployment/gpu-transcoding.md)                                             | Opt-in VAAPI/NVENC/QSV (CPU `libx264` is the default).                                                                                                                                                         |
| [Host parity](docs/deployment/host-parity.md)                                                     | Windows vs. Linux Docker differences + a verification test matrix.                                                                                                                                             |
| [Upgrading & images](docs/deployment/upgrading.md)                                                | Published GHCR image tags (multi-arch), pinning, and the upgrade path.                                                                                                                                         |
| [Home/Back guarantee](docs/home-back.md)                                                          | How the reserved Home/Back interception works (FR-A3 / NFR-5).                                                                                                                                                 |
| [Performance](docs/performance.md) · [v1.0 audit](docs/v1-audit.md)                               | NFR budget measurements; the Must-FR coverage audit.                                                                                                                                                           |
| [PRD](docs/prd.md) · [Implementation plan](docs/implementation_plan.md)                           | The "what" and the phased "how".                                                                                                                                                                               |

### The service catalog

Service tiles come from `services.yaml` + drop-in files in `services.d/`. The
first-run seed ships a curated **community catalog** in
[`config.example/`](config.example/) — Netflix and YouTube in `services.yaml`,
plus drop-ins in [`services.d/`](config.example/services.d/) (Disney+, Max, Prime
Video, Hulu, Apple TV, Paramount+, Peacock, Spotify, YouTube TV). Add your own by
dropping a `services.d/<name>.yaml` into `config/` — see
[config-reference § The community catalog](docs/config-reference.md#the-community-catalog-servicesd).

## Monorepo layout

OpenHearth is a pnpm workspace with three packages connected by TypeScript
project references:

```
packages/
  shared/   @openhearth/shared — the seam contract (types + schemas). Imports nothing else.
  server/   @openhearth/server — the "brain" (Fastify API, WS control, streaming). Imports shared.
  web/      @openhearth/web    — the "face" (React SPA in a kiosk). Imports shared.
```

### The seam rule

`web` never imports from `server`, and `server` never imports from `web`. Both
import only from `shared`. This is enforced two ways:

- **TypeScript project references** — neither `server` nor `web` references the
  other, so a cross-import fails to resolve.
- **ESLint** — `no-restricted-imports` patterns in `eslint.config.js` reject the
  import with an explicit "Seam violation" message.

## Development

Requires Node 20+ and pnpm.

```sh
pnpm install      # install all workspace dependencies
pnpm build        # build all packages via project references
pnpm typecheck    # type-check everything
pnpm lint         # ESLint across the workspace (incl. seam boundary check)
pnpm format       # Prettier write
pnpm test         # run package tests
pnpm dev          # watch-build all packages
```

## Continuous integration

Every pull request to `dev` (and every push to `dev`) runs
[`.github/workflows/ci.yml`](.github/workflows/ci.yml):

- **build-test** — `pnpm install --frozen-lockfile` (with pnpm cache) →
  Prettier check → lint → typecheck → test → build.
- **docker-build** — builds the production image from `docker/Dockerfile`
  (no push) with GitHub Actions layer caching.

The workflow needs no secrets and makes no outbound calls beyond fetching
dependencies and the base image (NFR-9). Any failing step fails the check.

### Requiring CI before merge (branch protection)

To make these checks mandatory, add a branch-protection rule for `dev`
(Settings → Branches → Add rule) and mark the **`Lint, typecheck, test & build`**
and **`Docker image build`** status checks as required. With protection on, a PR
to `dev` cannot merge until both jobs pass.

See [CLAUDE.md](CLAUDE.md) and [docs/implementation_plan.md](docs/implementation_plan.md)
for architecture and the phased roadmap.
