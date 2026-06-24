# Developer Guide

Developer-facing documentation for OpenHearth: how the codebase is structured,
how to build and test it from source, and the rules that keep the architecture
honest. If you just want to **run** OpenHearth, see the [README](README.md)
instead.

For the full requirements ("what") see [docs/prd.md](docs/prd.md); for the phased
roadmap ("how") see [docs/implementation_plan.md](docs/implementation_plan.md);
for working-in-the-repo conventions see [CLAUDE.md](CLAUDE.md).

---

## Architecture at a glance

OpenHearth is two logical pieces that communicate **only** through a documented
HTTP + WebSocket API (the "seam"):

- **Brain** (`packages/server`) — Fastify on Node 20 + TypeScript. Serves the web
  bundle, the REST API, the WebSocket control endpoint, media streaming, and runs
  ffmpeg child processes for transcoding.
- **Face** (`packages/web`) — React 18 + TypeScript + Vite SPA. Runs in a Chromium
  kiosk (`--kiosk --app=http://localhost:8080`). It is a pure client of the API
  and imports nothing from `server/`.
- **Shared** (`packages/shared`) — TypeScript types and JSON Schemas for the
  protocol, config, and media models. Imported by both `server` and `web`; this is
  what enforces the seam at compile time.

### The three content strategies

| Strategy       | Content                 | What OpenHearth does                                                                                |
| -------------- | ----------------------- | --------------------------------------------------------------------------------------------------- |
| A — Launcher   | Commercial services     | Renders tiles; navigates the kiosk to the service's web player on select; never touches the stream. |
| B — Aggregator | Cross-service discovery | Foundation only in v1 (normalized metadata model, stub search). Full unified search is v1.x.        |
| C — Player     | Local/self-hosted media | Native ad-free playback with ffmpeg transcoding fallback.                                           |

### Non-negotiable constraints

1. **Home/Back is always intercepted** by the display client before keys reach a
   launched commercial service (FR-A3, NFR-5). Highest-risk behavior; gets
   dedicated must-pass E2E tests. See [docs/home-back.md](docs/home-back.md).
2. **SQLite (`cache/`) is always derived and disposable** — never the source of
   truth. All user settings live in host-mapped YAML under `config/`. Every code
   path must tolerate a cold DB.
3. **Browser is the renderer; ffmpeg transcodes.** The container never pushes
   video to the host display. Local media plays via HTML5 `<video>` in the kiosk;
   the server transcodes to H.264/AAC fMP4 or HLS only when direct-play isn't
   possible.
4. **No phone-home, no telemetry.** The only outbound call is the user-configured
   metadata provider (TMDB) with the user's own key. Fully usable with no provider.
5. **Config errors never crash the UI.** The server validates YAML on load, falls
   back to last-good config, and surfaces errors as non-fatal banners.

---

## Monorepo layout

OpenHearth is a pnpm workspace with three packages connected by TypeScript
project references:

```
packages/
  shared/   @openhearth/shared — the seam contract (types + schemas). Imports nothing else.
  server/   @openhearth/server — the "brain" (Fastify API, WS control, streaming). Imports shared.
  web/      @openhearth/web    — the "face" (React SPA in a kiosk). Imports shared.
```

A fuller breakdown of `server/src/core/*` services, the `config.example/` seed,
and the `docs/` set is in [CLAUDE.md](CLAUDE.md).

### The seam rule

`web` never imports from `server`, and `server` never imports from `web`. Both
import only from `shared`. This is enforced two ways:

- **TypeScript project references** — neither `server` nor `web` references the
  other, so a cross-import fails to resolve.
- **ESLint** — `no-restricted-imports` patterns in `eslint.config.js` reject the
  import with an explicit "Seam violation" message.

Any cross-import is a bug.

---

## Building from source

Requires **Node 20+** and **pnpm** (see [`.nvmrc`](.nvmrc)).

```sh
pnpm install      # install all workspace dependencies
pnpm build        # build all packages via project references
pnpm typecheck    # type-check everything (tsc --noEmit)
pnpm lint         # ESLint across the workspace (incl. seam boundary check)
pnpm format       # Prettier write
pnpm test         # run package tests (Vitest)
pnpm dev          # watch-build all packages / start server + web in dev mode
```

### Per-package and single-file

```sh
pnpm --filter server test
pnpm --filter web test
pnpm --filter shared test

# A single test file
pnpm --filter server vitest run src/core/ConfigService.test.ts
```

### Running the container from a checkout

The reference [`docker-compose.yml`](docker-compose.yml) has a `build:` block, so
you can build the image locally instead of pulling it:

```sh
docker compose up --build
```

Drop the `build:` block to pull the published `ghcr.io/imonroe/openhearth:latest`
instead. The multi-stage [`docker/Dockerfile`](docker/Dockerfile) builds web +
server and produces a slim Node 20 + ffmpeg runtime.

---

## Testing

- **Unit / contract** (Vitest) — config validation, catalog parsing, ffprobe
  logic, metadata normalization, protocol schema validation.
- **Integration** (Vitest + supertest) — API routes, streaming, WS round-trips.
- **E2E** (Playwright, under [`e2e/`](e2e/)) — focus navigation, tile launch,
  **Home/Back return** (must-pass), player controls, resume.

The **Home/Back guarantee** and **graceful config failure** get dedicated,
must-pass tests — they are the behaviors most likely to silently regress.

---

## Continuous integration

Every pull request to `dev` (and every push to `dev`) runs
[`.github/workflows/ci.yml`](.github/workflows/ci.yml):

- **build-test** — `pnpm install --frozen-lockfile` (with pnpm cache) → Prettier
  check → lint → typecheck → test → build.
- **docker-build** — builds the production image from `docker/Dockerfile`
  (no push) with GitHub Actions layer caching.

The workflow needs no secrets and makes no outbound calls beyond fetching
dependencies and the base image (NFR-9). Any failing step fails the check.

### Requiring CI before merge (branch protection)

To make these checks mandatory, add a branch-protection rule for `dev`
(Settings → Branches → Add rule) and mark the **`Lint, typecheck, test & build`**
and **`Docker image build`** status checks as required. With protection on, a PR
to `dev` cannot merge until both jobs pass.

---

## Remote-control protocol

The `ControlService` exposes:

- `POST /api/v1/control/command` — REST mirror for simple clients.
- `WS /api/v1/control/ws` — bidirectional JSON; clients send commands, the server
  broadcasts `state_changed` events.

The action vocabulary (defined in `shared/protocol`) is: `navigate`, `select`,
`back`, `home`, `play_pause`, `seek`, `stop`, `launch_service`, `play_item`,
`set_volume`. `home` is reserved and always returns to the OpenHearth home
screen. The keyboard handler maps YAML-configured keys to exactly these actions —
no action is keyboard-specific. The frozen v1 contract is specified in
[docs/protocol.md](docs/protocol.md).

---

## Visual design

[`designs/design-system.md`](designs/design-system.md) is the authoritative
reference for all visual styling — color tokens, typography, spacing, the focus
system, and per-component specs. [`designs/screen-inventory.md`](designs/screen-inventory.md)
lists all 15 screens with their states and navigation flows. Read the relevant
section before writing CSS for `packages/web`.

Key rules:

- The design was specified at 1920 × 1080. **All layout sizes, spacing, and
  typography are implemented in `rem`, not `px`**, with `font-size: 1vw` on
  `:root` so the UI scales from 720p to 4K without media queries. Only border
  widths, box-shadows, and border-radius stay in `px`.
- The **focus system** is the most critical part of the TV UI: exactly one
  focused element at all times (focus never disappears), an amber ring + outer
  glow on every focused element, and the focused tile label recolored to amber.

The designs live in [`designs/designs_1.pen`](designs/designs_1.pen) (Pencil MCP
format) — never `Read` or `Grep` it directly. Use the Pencil MCP tools when
available, otherwise `design-system.md` is a self-contained handoff document.

---

## Branching convention

Feature branches target **`dev`**. Only tagged releases land on **`main`**. PRs to
`dev` must pass CI (lint, typecheck, tests, image build) before merge.
