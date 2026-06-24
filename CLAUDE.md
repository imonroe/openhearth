# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenHearth is a Docker-native, self-hosted streaming hub with a TV-optimized 10-foot UI. It combines a **launcher** for commercial streaming services (Netflix, YouTube, etc.), a **native player** for local/self-hosted media with ffmpeg transcoding, and a **discovery foundation** for cross-service metadata. The design intent is to replace a Roku/Fire TV box with an ad-free, fully configurable, open-source alternative.

The full requirements live in [docs/prd.md](docs/prd.md). The implementation strategy is in [docs/implementation_plan.md](docs/implementation_plan.md).

## Status

The codebase is in **Phase 0 (pre-scaffolding)**. The workspace, packages, and Docker image do not yet exist. All implementation follows the plan in `docs/implementation_plan.md`, targeting **M0** first.

## Planned Commands

Once scaffolded (pnpm workspaces with `packages/shared`, `packages/server`, `packages/web`):

```sh
pnpm build          # build all packages
pnpm test           # run all tests (Vitest)
pnpm dev            # start server + web in dev mode
pnpm lint           # ESLint + Prettier check
pnpm typecheck      # tsc --noEmit across all packages

# Single package
pnpm --filter server test
pnpm --filter web test
pnpm --filter shared test

# Single test file
pnpm --filter server vitest run src/core/ConfigService.test.ts

# Docker
docker-compose up
docker-compose up --build
```

## Architecture

The system has two logical pieces that communicate **only** via a documented HTTP + WebSocket API (the "seam"):

- **Brain** (`packages/server`): Fastify (Node 20 + TypeScript). Serves the web UI bundle, the API, WebSocket control endpoint, media streaming, and runs ffmpeg child processes for transcoding.
- **Face** (`packages/web`): React 18 + TypeScript + Vite SPA. Runs in a Chromium kiosk (`--kiosk --app=http://localhost:8080`). Pure client of the API — imports nothing from `server/`.
- **Shared** (`packages/shared`): TypeScript types and JSON Schemas for the protocol, config, and media models. Imported by both `server` and `web`. This is what enforces the seam at compile time.

### The Seam Rule

`web/` never imports from `server/`. Both import only from `shared/`. Workspace boundaries and TypeScript project references enforce this. Any cross-import is a bug.

### Key Architectural Constraints (non-negotiable)

1. **Home/Back is always intercepted** by the display client before keys reach a launched commercial service. This is the single highest-risk behavioral requirement (FR-A3, NFR-5). It gets dedicated must-pass E2E tests.
2. **SQLite (`cache/`) is always derived and disposable** — never the source of truth. All user settings live in host-mapped YAML under `config/`. Any code path must tolerate a cold DB.
3. **Browser is the renderer; ffmpeg transcodes** — the container never pushes video to the host display. Local media plays via HTML5 `<video>` in the kiosk; the server transcodes to H.264/AAC fMP4 or HLS when direct-play isn't possible.
4. **No phone-home, no telemetry.** The only outbound calls are the user-configured metadata provider (TMDB) using the user's own API key. The app must be fully usable with no provider configured.
5. **Config errors never crash the UI.** The server validates YAML on load, falls back to last-good config, and surfaces errors as non-fatal banners.

### Three Content Strategies

| Strategy | Content type | What OpenHearth does |
|---|---|---|
| A — Launcher | Commercial services | Renders tiles; navigates kiosk to service's web player on select; never touches the stream. |
| B — Aggregator | Cross-service discovery | Foundation only in v1 (normalized metadata model, stub search). Full unified search is v1.x. |
| C — Player | Local/self-hosted media | Native ad-free playback with ffmpeg transcoding fallback. |

## Repository Layout (planned)

```
packages/
  shared/src/
    protocol/   — action vocabulary, WS message envelopes, protocol_version
    config/     — YAML config types + JSON Schema
    models/     — normalized media/metadata model
  server/src/
    app.ts              — Fastify bootstrap
    routes/             — api/, ws/, stream/, static/
    core/
      ConfigService     — load + validate + chokidar hot-reload
      CatalogService    — service tile definitions
      LibraryService    — folder scan + optional Jellyfin/Plex reads
      MetadataService   — pluggable provider (TMDB)
      TranscodeService  — ffprobe decision + ffmpeg orchestration
      ControlService    — action vocabulary state machine + WS broadcast
      CacheStore        — SQLite (library index, metadata cache, resume positions)
  web/src/              — React SPA, focus engine, tile grid, player
config.example/         — seed config shipped to users
  openhearth.yaml
  services.yaml
  services.d/           — community service definitions (netflix.yaml, youtube.yaml, …)
docker/Dockerfile       — multi-stage: build web + server → slim Node 20 + ffmpeg runtime
docker-compose.yml      — reference compose
docs/
  prd.md                — requirements (the "what")
  implementation_plan.md — implementation strategy (the "how")
  protocol.md           — (Phase 5) versioned remote-control protocol spec
  config-reference.md   — config schema documentation
  deployment/           — windows-kiosk.md, linux-kiosk.md
designs/                — wireframes, focus maps, visual language artifacts
  designs_1.pen         — source designs (all 15 screens + components, Pencil format)
  design-system.md      — authoritative visual spec and developer handoff reference
  screen-inventory.md   — screen list, navigation map, per-screen design notes
scripts/kiosk/          — example Chromium kiosk launch shortcuts/units
```

## Remote-Control Protocol

The `ControlService` exposes:
- `POST /api/v1/control/command` — REST mirror for simple clients
- `WS /api/v1/control/ws` — bidirectional JSON; clients send commands, server broadcasts `state_changed` events

Action vocabulary (defined in `shared/protocol`): `navigate`, `select`, `back`, `home`, `play_pause`, `seek`, `stop`, `launch_service`, `play_item`, `set_volume`. The `home` action is reserved and always returns to the OpenHearth home screen. The keyboard handler maps YAML-configured keys to exactly these actions — no action is keyboard-specific.

## Volumes & Configuration

Three host-mapped volumes:
- `./config:/config` — user-editable YAML (source of truth); hot-reloaded via chokidar
- `/path/to/media:/media:ro` — read-only library source
- `./cache:/cache` — derived SQLite index, artwork, transcode segments (disposable)

Secrets (TMDB API key, etc.) go in environment variables or `${VAR}` interpolation in YAML — never committed.

## Branching Convention

Feature branches target **`dev`**. Only tagged releases land on **`main`**. PRs to `dev` must pass CI (lint, typecheck, tests, image build) before merge.

## Visual Design & Styling

### Source of truth

**[`designs/design-system.md`](designs/design-system.md) is the authoritative reference for all visual styling decisions.** Before writing any CSS, Tailwind classes, or inline styles for `packages/web`, read the relevant section of that document. It covers:

- Color tokens (hex values and CSS custom property names)
- Typography scale (font sizes, weights, letter-spacing, line-height per role)
- Spacing scale and safe-area margins
- Border radius values
- Box-shadow / glow specifications for every elevation level
- Focus system rules (the most critical part of the TV UI)
- All component specifications (Service Tile, Library Tile, CTA buttons, Progress Bar, Modal, etc.)
- Screen-by-screen layout measurements
- Responsive scaling strategy (`font-size: 1vw` on `:root`; everything in `rem`)
- Motion and transition timing

### Responsive scaling rule

The design was specified at 1920 × 1080 px. **All layout sizes, spacing, and typography must be implemented in `rem`, not `px`.** Set `font-size: 1vw` on `:root` so that `1rem = 1% of viewport width`. This makes the UI scale correctly from 720p to 4K without media queries. Only border widths, box-shadow values, and border-radius should remain in `px`. See `design-system.md` § 2 for the full conversion table and rationale.

### CSS custom properties

Implement the color palette and safe-area tokens as CSS custom properties on `:root`, exactly as specified in `design-system.md` § 2. Reference them by name throughout component styles — do not hardcode hex values in component files.

### Screen inventory

[`designs/screen-inventory.md`](designs/screen-inventory.md) lists all 15 screens, their states, navigation flows, and per-screen design notes. Refer to it when implementing a new screen to understand what states must be handled and how focus should enter and exit the screen.

### Pencil design files

The visual designs live in [`designs/designs_1.pen`](designs/designs_1.pen), a Pencil MCP format file. **The Pencil MCP tool may not be available in all environments.** When it is available, use `mcp__pencil__get_screenshot` or `mcp__pencil__get_editor_state` to inspect the designs directly. When it is not available, `design-system.md` contains all the information needed to implement every screen — it was written specifically to be a self-contained handoff document that does not require access to the `.pen` file.

Never `Read` or `Grep` a `.pen` file directly — it is a binary/encrypted format. Go through Pencil MCP tools or `design-system.md` instead.

### Focus system

The focus system is the most critical part of this UI. Every interactive element must have a visible focus state. The rules are non-negotiable:
- One focused element at all times — focus never disappears
- Amber ring (`3px solid #F5A623`) + outer glow (`0 0 0 8px rgba(245,166,35,0.40), 0 0 20px rgba(245,166,35,0.40)`) on all focused elements
- Focused tile label color changes to `#F5A623`
- The `Home` key is always intercepted by the kiosk before reaching any launched service — this is enforced at the browser level, not in React

## Testing

- **Unit/contract** (Vitest): config validation, catalog parsing, ffprobe logic, metadata normalization, protocol schema validation
- **Integration** (Vitest + supertest): API routes, streaming, WS round-trips
- **E2E** (Playwright): focus navigation, tile launch, **Home/Back return** (must-pass), player controls, resume
- The Home/Back guarantee and graceful config failure get dedicated, must-pass tests — they are the behaviors most likely to silently regress
