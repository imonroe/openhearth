# OpenHearth — Implementation Plan

> How we build the product specified in [`docs/prd.md`](./prd.md). This document
> evaluates three competing implementation strategies, selects one with
> rationale, and lays out a thorough, dependency-ordered, step-by-step plan to
> reach **v1.0**.

| | |
|---|---|
| **Document status** | Draft v1.0 |
| **Last updated** | 2026-06-23 |
| **Companion** | [`docs/prd.md`](./prd.md) (the source of truth for *what* we build) |
| **Scope** | OpenHearth v1.0 — the launcher + player foundation |
| **Branching** | Feature branches → `dev`; tagged releases → `main` |

---

## Table of Contents

1. [How to Read This Document](#1-how-to-read-this-document)
2. [Constraints Inherited From the PRD](#2-constraints-inherited-from-the-prd)
3. [Competing Strategies](#3-competing-strategies)
4. [Strategy Evaluation & Selection](#4-strategy-evaluation--selection)
5. [Selected Architecture in Detail](#5-selected-architecture-in-detail)
6. [Repository & Module Layout](#6-repository--module-layout)
7. [Cross-Cutting Foundations](#7-cross-cutting-foundations)
8. [Phased Implementation Plan](#8-phased-implementation-plan)
9. [Data Model & Schemas](#9-data-model--schemas)
10. [Remote-Control Protocol Build-Out](#10-remote-control-protocol-build-out)
11. [Testing Strategy](#11-testing-strategy)
12. [CI/CD & Release Engineering](#12-cicd--release-engineering)
13. [Dependency-Ordered Task Checklist](#13-dependency-ordered-task-checklist)
14. [Risk Register (Implementation)](#14-risk-register-implementation)
15. [Definition of Done — v1.0](#15-definition-of-done--v10)

---

## 1. How to Read This Document

The PRD defines **what** OpenHearth is and **which** technologies were chosen
(Node + TypeScript + Fastify; React + TypeScript + Vite; single Docker
container; ffmpeg; TMDB; HTTP + WebSocket control protocol). This document
defines **how** we assemble those pieces and **in what order**.

Requirement IDs (e.g. `FR-A1`, `NFR-5`) and section refs (e.g. `§11`) point
back into the PRD so every build step is traceable to a requirement.

---

## 2. Constraints Inherited From the PRD

These are non-negotiable inputs to the plan:

- **Single box, single `docker-compose up`** for v1 (§15) — deployment must
  stay trivial.
- **Clean seam between "brain" (server) and "face" (client)** (§7.4, NFR-8) —
  they communicate *only* over the documented, versioned HTTP + WS API.
- **Host-mapped YAML config is the source of truth** (§10); the index/cache is
  derived and disposable.
- **The Home/Back guarantee is a Must** (FR-A3, FR-R3, NFR-5) and must be
  designed in, not bolted on.
- **Browser is the renderer; ffmpeg in the container transcodes** (§7.2, §12) —
  no container-side video window.
- **No phone-home, trusted-LAN default** (§17, NFR-9).
- **Windows and Linux are co-equal hosts** (§15.2).
- The chosen stack is fixed; strategies below differ in **how we structure and
  sequence the build**, not in re-litigating the language choice.

---

## 3. Competing Strategies

Three genuinely different ways to structure the implementation. All three use
the PRD-mandated stack; they differ in process boundaries, front-end
philosophy, and how the brain/face seam is enforced.

### Strategy 1 — Single-Container Modular Monorepo (SPA + API)

One repository organized as **npm/pnpm workspaces** with three packages:

- `shared/` — protocol types, config schemas, action vocabulary (the contract).
- `server/` — Fastify app: API, WebSocket, config loader/watcher, library
  indexer, metadata clients, ffmpeg orchestration.
- `web/` — React + Vite SPA (the 10-foot UI), a pure client of the API.

The build produces **one Docker image**: the server serves the API/WS and the
pre-built static SPA bundle. The kiosk browser points at it. The `shared`
package is imported by both `server` and `web`, so the seam contract is
**enforced by the type system** — drift between brain and face becomes a
compile error.

- **Process model:** one Node process + ffmpeg child processes. One container.
- **Seam enforcement:** shared TypeScript package + JSON Schema; phone remote
  later is just another consumer of `shared`.
- **Deployment:** single `docker-compose up`.

### Strategy 2 — Multi-Container / Sidecar Split

Decompose along runtime concerns into multiple containers wired by compose:

- `web` container (static SPA behind nginx),
- `api` container (Fastify control + metadata + config),
- `transcoder` container (ffmpeg + streaming),
- optionally a reverse proxy.

"Cleaner" separation of concerns and independently scalable transcoding, at the
cost of inter-service networking, shared-volume coordination for transcode
segments, multi-image builds, and a heavier compose file.

- **Process model:** 3–4 containers, shared volumes, internal HTTP between them.
- **Seam enforcement:** network boundaries (strong) but more moving parts.
- **Deployment:** a multi-service compose; more to break on a mini-PC.

### Strategy 3 — Server-Rendered Thin Client (HTMX / no SPA build)

Skip the SPA. Fastify renders HTML server-side (templating + HTMX-style partial
swaps); the client carries only a thin JS layer for keyboard capture and the
HTML5 `<video>` element. UI state lives largely on the server.

- **Process model:** one container, no front-end build pipeline.
- **Seam enforcement:** weaker — UI logic and state live server-side, so a phone
  remote can't simply reuse a client-side model; the "face" is partly inside
  the "brain."
- **Deployment:** single container, simplest build.

---

## 4. Strategy Evaluation & Selection

Rated 1–5 (5 = best) on the PRD's stated preferences: **low complexity**,
**high ease of implementation**, **high elegance**. "Elegance" here means
fidelity to the PRD's architectural principles — especially the clean
brain/face seam (§7.4) that makes the phone remote and multi-device additive,
not a rewrite.

| Criterion (weight) | S1: Monorepo SPA | S2: Multi-container | S3: Server-rendered |
|---|:---:|:---:|:---:|
| **Low complexity** (×1.5) | 4 | 2 | 4 |
| **Ease of implementation** (×1.5) | 5 | 2 | 4 |
| **Elegance / PRD fidelity** (×2.0) | 5 | 4 | 2 |
| **Weighted total** (max 25) | **23.5** | 14.0 | 16.0 |

**Reasoning:**

- **S1** is low-complexity (one image, one process) *and* high-elegance: the
  `shared` package turns the brain/face seam into a typed, compile-checked
  contract, which is exactly the "clean seam" the PRD makes a guiding principle.
  A React SPA is also the natural fit for a 10-foot UI's spatial-navigation
  focus engine and smooth, reactive transitions. Easiest path to all v1 Musts.
- **S2** scores well on raw separation but loses badly on complexity and ease:
  multi-container networking, shared transcode volumes, and several images are
  real overhead that buys nothing for a single-box v1. It also contradicts the
  "single `docker-compose up`" constraint's spirit. The split it offers is a
  *future* option (§23 multi-device), not a v1 need.
- **S3** is simple to start but its elegance is poor *for this product*: a
  10-foot UI with directional focus, animated tiles, and live WS-driven state
  is awkward in server-rendered partials, and — critically — putting UI state in
  the server **weakens the seam**, making the future phone remote harder, not
  easier. That directly undercuts the PRD's central architectural bet.

### Decision

> **Selected: Strategy 1 — Single-Container Modular Monorepo (SPA + API).**

It best satisfies *low complexity + high ease + high elegance* simultaneously,
and it is the only option that makes the brain/face seam a first-class,
type-enforced contract while keeping deployment to a single
`docker-compose up`. (A discarded fourth option — an Electron/native app — was
rejected outright because the PRD already fixes the renderer as a kiosk
browser, §7.2.)

The rest of this document plans the build of Strategy 1.

---

## 5. Selected Architecture in Detail

```
┌──────────────────────── openhearth (single container) ────────────────────────┐
│                                                                                │
│  Fastify (Node 20, TS)                                                         │
│   ├── HTTP API            /api/v1/*            (config, services, library)     │
│   ├── WebSocket           /api/v1/control/ws   (commands ↔ state events)       │
│   ├── Static host         /                    (pre-built web/ SPA bundle)     │
│   ├── Media streaming     /api/v1/library/:id/stream  (direct play / HLS)      │
│   └── Health              /api/v1/health                                       │
│                                                                                │
│  Core services (server/src/core)                                               │
│   ├── ConfigService    — load + JSON-Schema validate + chokidar hot-reload     │
│   ├── CatalogService   — service tiles (services.yaml + services.d/*)          │
│   ├── LibraryService   — folder scan + (optional) Jellyfin/Plex read           │
│   ├── MetadataService  — pluggable provider (TMDB), local cache                │
│   ├── TranscodeService — ffprobe decision + ffmpeg child processes             │
│   ├── ControlService   — action vocabulary, state machine, WS broadcast        │
│   └── CacheStore       — SQLite (index, metadata, resume positions)            │
│                                                                                │
│  shared/ (imported by server + web + future remote)                           │
│   ├── protocol  — action vocabulary, message envelopes, protocol_version       │
│   ├── config    — YAML schema types + JSON Schema                              │
│   └── models    — normalized media/metadata model                              │
└────────────────────────────────────────────────────────────────────────────────┘
         ▲ HTTP/WS                                            ffmpeg child procs ─┘
         │
   web/ SPA (React+Vite)  ──rendered by──►  Chromium kiosk  ──HDMI──►  TV
```

**Key architectural rules:**

1. `web/` never imports from `server/`; both import only from `shared/`. This is
   the seam, enforced by the workspace boundaries and TS project references.
2. The control **action vocabulary** (§11.4) is defined once in
   `shared/protocol` and consumed by the keyboard handler, the server, and
   (later) the phone remote.
3. SQLite is a **cache**: any code path must tolerate a cold/empty DB and
   rebuild from config + filesystem + provider.
4. All outbound network calls go through `MetadataService` and are disabled when
   no provider key is configured (NFR-9, §13).

---

## 6. Repository & Module Layout

```
openhearth/
├── docs/
│   ├── prd.md
│   ├── implementation_plan.md        # this file
│   ├── config-reference.md           # generated/maintained config docs
│   ├── protocol.md                   # remote-control protocol spec (§10)
│   └── deployment/
│       ├── windows-kiosk.md          # auto-launch (§14.2)
│       └── linux-kiosk.md
├── designs/                          # wireframes, focus maps (per repo convention)
├── packages/
│   ├── shared/
│   │   ├── src/protocol/             # actions, message envelopes, versions
│   │   ├── src/config/               # config types + JSON Schema
│   │   └── src/models/               # normalized media/metadata model
│   ├── server/
│   │   ├── src/app.ts                # Fastify bootstrap
│   │   ├── src/routes/               # api + ws + stream + static
│   │   ├── src/core/                 # the services listed in §5
│   │   └── test/
│   └── web/
│       ├── src/                      # React SPA, focus engine, player, tiles
│       ├── index.html
│       └── vite.config.ts
├── config.example/                   # seed config shipped to users
│   ├── openhearth.yaml
│   ├── services.yaml
│   └── services.d/                   # community-catalog seed (netflix, youtube…)
├── scripts/
│   ├── kiosk/                        # example launch shortcuts/units
│   └── dev/                          # local dev helpers
├── docker/
│   └── Dockerfile                    # multi-stage: build web + server → runtime
├── docker-compose.yml                # reference compose (§15.1)
├── package.json                      # workspace root
├── tsconfig.base.json
└── .github/workflows/                # CI/CD (§12)
```

**Tooling:** pnpm workspaces (or npm workspaces), TypeScript project references,
ESLint + Prettier, Vitest for unit tests, Playwright for UI/e2e.

---

## 7. Cross-Cutting Foundations

Built early and relied on by every phase:

- **Typed config + schema (`shared/config`).** A single source generates both
  the TS types and the runtime JSON Schema (e.g. via `zod` → JSON Schema, or
  TypeBox). `ConfigService` validates against it and surfaces friendly errors
  (FR-CFG2) without crashing the UI (NFR-4).
- **Protocol contract (`shared/protocol`).** Action vocabulary + message
  envelopes + `protocol_version` constant. Validated at the WS boundary with the
  same schema tooling.
- **Result/error conventions.** Server returns structured errors; the UI shows a
  non-fatal banner on config or provider problems.
- **Logging.** Structured stdout (pino), level from config, **no telemetry**
  (NFR-9, FR-S4).
- **Feature seams for optionality.** Metadata provider and library integrations
  are interfaces with a default implementation, so "no provider" and "folder
  scan only" are first-class (§10.4, §13).

---

## 8. Phased Implementation Plan

Phases map to PRD milestones **M0–M4 + release** (§20). Each phase lists tasks,
the FR/NFR IDs it satisfies, and an **exit criterion** that gates the next
phase. Each phase is a small set of PRs targeting `dev`.

### Phase 0 — Project Scaffolding & Tooling

**Goal:** a buildable, testable, containerized skeleton with the workspace seam
in place.

Tasks:
1. Initialize pnpm workspace; create `shared`, `server`, `web` packages with TS
   project references and a shared `tsconfig.base.json`.
2. Wire ESLint + Prettier + Vitest; add `pnpm build`, `pnpm test`, `pnpm dev`.
3. Author `docker/Dockerfile` (multi-stage: build `web`, build `server`, slim
   Node 20 + ffmpeg runtime) and the reference `docker-compose.yml` (§15.1).
4. Stub `shared/protocol` (`protocol_version = 1`, action enum) and
   `shared/config` (empty schema that validates `{}`).
5. CI: lint + typecheck + test + image build on PRs to `dev` (§12).

**Exit criterion:** `docker-compose up` serves an empty page from the server;
CI is green. *(No PRD feature yet — this is M0 groundwork.)*

### Phase 1 — M0: Config, Health, UI Shell

**Goal:** the brain boots from YAML and the face renders an (empty) 10-foot
shell.

Tasks (server):
1. Implement `ConfigService`: load `openhearth.yaml` + `services.yaml` +
   `services.d/*`, validate, expose effective config; **chokidar hot-reload**
   with last-good fallback (FR-CFG1, FR-CFG2, FR-CFG4, NFR-4).
2. `GET /api/v1/health` (FR-S2) and `GET /api/v1/config` (§11.2).
3. Ship `config.example/` with sensible defaults; document each field in
   `docs/config-reference.md` (FR-CFG3, FR-CFG5).
4. Structured logging + startup diagnostics (config validation summary)
   (FR-S4, §15.3).

Tasks (web):
5. React + Vite shell with the **focus engine** scaffold (directional
   navigation primitives), TV-safe-area layout, large-type/high-contrast theme
   (§14.3, NFR-1, NFR-10).
6. App boots, fetches `/api/v1/config`, renders configured rows (empty tiles
   ok).

**Exit criterion (PRD M0):** `docker-compose up` serves the UI shell; config
validates and hot-reloads; health green.

### Phase 2 — M1: Launcher (Strategy A) + Control Protocol Core

**Goal:** the headline feature — launch a real service and reliably return.

Tasks:
1. `CatalogService`: parse service definitions into the tile model; expose
   `GET /api/v1/services` (FR-A1, FR-A4, §10.3).
2. Web: render the service grid with artwork (local/URL/placeholder), focusable
   tiles, grouping/order (FR-A1, FR-A6).
3. **Launch flow:** on `select`, navigate the kiosk to `launch_url` (FR-A2).
4. **Home/Back guarantee:** display-client key interception that always returns
   to OpenHearth from a launched service; reserved `home` action (FR-A3, FR-R3,
   §11.5, NFR-5). *Treated as a hard requirement with dedicated tests.*
5. `ControlService` + `shared/protocol`: implement the action vocabulary
   (`navigate`, `select`, `back`, `home`, `launch_service`, …), the WS endpoint
   `/api/v1/control/ws`, and **state broadcast** (FR-R2, FR-R5, §11).
6. Keyboard handler maps configured keys → actions (FR-R1, FR-R4, §10.2).
7. Seed the **community catalog** (`config.example/services.d/`: Netflix,
   YouTube TV, Max, Disney+, …) with per-service compatibility notes (FR-A5,
   §18).

**Exit criterion (PRD M1):** can launch a real commercial service and reliably
return via Home/Back; keyboard drives navigation; WS broadcasts state.

### Phase 3 — M2: Local Media Player (Strategy C)

**Goal:** native, ad-free playback of the user's own library.

Tasks:
1. `LibraryService`: scan host-mapped folders; detect Movies vs TV
   (season/episode) by naming; persist the index in SQLite (FR-C1, FR-C6, §9.2).
2. API: `GET /api/v1/library`, `GET /api/v1/library/:id` (§11.2).
3. Web: library rows/tiles, item detail, browse via focus engine (FR-C2).
4. **Streaming endpoint** `GET /api/v1/library/:id/stream`: ffprobe →
   direct-play (range requests) when supported; else `TranscodeService` runs
   ffmpeg to H.264/AAC fMP4/HLS into `cache/` (FR-C3, FR-C4, §12).
5. Player UI: HTML5 `<video>`, play/pause/seek/stop, **resume** from saved
   position (FR-C5, §12.2); wire `play_pause`/`seek`/`stop` actions.
6. **Subtitles:** embedded + sidecar `.srt`/`.vtt` as tracks; burn-in only when
   undeliverable (FR-C7, §12.2).
7. GPU transcode **opt-in** path documented (VAAPI/NVENC/QSV), CPU fallback as
   the guaranteed path (§12.2, §18).

**Exit criterion (PRD M2):** common library formats play (direct or
transcoded); resume and subtitles work; transcode fallback verified.

### Phase 4 — M3: Metadata & Discovery Foundation (Strategy B foundation)

**Goal:** artwork/metadata for tiles and library; the normalized model that a
future unified search will query.

Tasks:
1. `MetadataService` with a **pluggable provider interface**; implement the
   **TMDB** provider using the user's own key (FR-B1, §13).
2. Normalized internal model in `shared/models` (title, IDs, art, availability
   placeholder) (FR-B2).
3. Cache fetched metadata/artwork in `cache/`; **graceful degradation** to
   filename-derived titles when no provider configured (§13.2).
4. Apply metadata to library tiles and (where useful) service tiles
   (FR-A6, FR-C2).
5. Stub a search surface returning local-library results, extensible later
   (FR-B3).

**Exit criterion (PRD M3):** tiles and library show artwork/metadata; the app
degrades gracefully with no key.

### Phase 5 — M4: Protocol Hardening, Ops & Docs

**Goal:** make the seam contract stable and ship the operational story.

Tasks:
1. Finalize and **version** the HTTP + WS protocol; publish `docs/protocol.md`
   as the contract the phone remote will implement (§11, §23).
2. Configurable keybindings end-to-end; document defaults (FR-R4, §10.2).
3. Optional **shared-token auth** for API/WS (Should); reserved auth field wired
   (§11.6, §17).
4. Health/readiness, structured logs, log-level config finalized (FR-S2, FR-S4).
5. **Auto-launch docs + example scripts** for Windows (Startup/Task Scheduler)
   and Linux (systemd/autostart) kiosk (FR-S3, §14.2); ship under `scripts/kiosk`.
6. Verify **Windows-Docker and Linux-Docker** parity, including path mapping and
   GPU notes (NFR-6, §15.2, §18).
7. Performance pass against NFR targets (home interactive ~2s, nav ~100ms,
   direct-play ~2s) (NFR-1..3).

**Exit criterion (PRD M4):** protocol documented and stable; both host paths
documented and verified.

### Phase 6 — v1.0 Release

Tasks:
1. Confirm **all Must FRs** across M1–M4 are met; triage Shoulds.
2. Complete docs: README quickstart, config reference, protocol, deployment,
   community-catalog seed.
3. Publish versioned image to `ghcr.io/imonroe/openhearth` + `latest` (§15.3).
4. **Tag the release on `main`** (per branching convention); `dev` remains the
   integration branch.

**Exit criterion (PRD v1.0):** tagged release on `main`; image published; docs
complete; example config + community catalog seed shipped.

---

## 9. Data Model & Schemas

### 9.1 Config (source of truth — YAML)

Implemented exactly as the PRD §10 schema: `openhearth.yaml` (ui rows, library
sources, metadata provider, keybindings) and `services.yaml` / `services.d/*`
(tile definitions). Types + JSON Schema live in `shared/config`.

### 9.2 SQLite Cache (derived — disposable)

A single `cache/openhearth.db`. **Never** the source of truth; rebuildable from
config + filesystem + provider.

```
library_items(
  id TEXT PRIMARY KEY,         -- stable hash of source path
  source_id TEXT,              -- maps to library.sources[].id
  kind TEXT,                   -- movie | episode | other
  path TEXT, title TEXT, year INT,
  season INT, episode INT, parent_id TEXT,
  duration_sec INT, container TEXT, video_codec TEXT, audio_codec TEXT,
  mtime INT, indexed_at INT
)

metadata_cache(
  item_key TEXT PRIMARY KEY,   -- normalized title/id key
  provider TEXT, payload JSON, art_path TEXT, fetched_at INT
)

resume_positions(
  item_id TEXT PRIMARY KEY, position_sec INT, updated_at INT
)
```

### 9.3 Normalized Media Model (`shared/models`)

Provider-agnostic shape consumed by the UI and the future Aggregator: `{ id,
title, year, kind, artwork, ids, availability? }`. `availability` is a reserved
slot for a later JustWatch-style source (§13, §23).

---

## 10. Remote-Control Protocol Build-Out

Implements PRD §11. The contract is the deliverable that unlocks the phone
remote (`openhearth-remote`) and multi-device.

- **Definition:** action vocabulary + message envelopes + `protocol_version`
  in `shared/protocol`, validated by JSON Schema at the WS boundary.
- **REST mirror:** every command is also reachable via
  `POST /api/v1/control/command` for simple clients (§11.2).
- **State broadcast:** `state_changed` events carry `{ screen, focus, playback }`
  so all clients stay in sync (FR-R5, §11.3).
- **Versioning:** breaking changes bump `protocol_version`; the auth field is
  reserved from day one so token auth is additive (§11.6).
- **Documentation:** `docs/protocol.md` written as an external contract (request
  shapes, event shapes, the Home/Back guarantee, error model).

The Phase-2 implementation lands the core vocabulary; Phase 5 freezes/versions
and documents it.

---

## 11. Testing Strategy

| Layer | Tooling | What it covers |
|---|---|---|
| Unit | Vitest | Config validation/hot-reload, catalog parsing, ffprobe decision logic, metadata normalization, protocol message validation. |
| Contract | Vitest + JSON Schema | Every protocol message and config file validates against `shared` schemas; guards the seam. |
| Integration | Vitest + supertest | API routes, streaming (direct vs transcode), WS command/event round-trips. |
| E2E / UI | Playwright | Focus navigation, tile launch, **Home/Back return** (NFR-5 — a dedicated, must-pass test), player controls, resume. |
| Manual matrix | Checklist | Windows-Docker + Linux-Docker; CPU and GPU transcode; representative codecs; kiosk auto-launch (§14.2). |

**Non-negotiable tests:** the **Home/Back guarantee** (FR-A3) and **graceful
config failure** (NFR-4) get explicit, must-pass coverage because they are the
behaviors most likely to silently regress.

---

## 12. CI/CD & Release Engineering

- **PR CI (→ `dev`):** lint, typecheck, unit + contract + integration tests,
  `web` build, Docker image build. Required to pass before merge.
- **E2E:** Playwright job (headless Chromium) on PRs touching `web`/protocol.
- **Image publish:** on tagged release, build and push
  `ghcr.io/imonroe/openhearth:<version>` and `:latest` (multi-arch where
  practical for Linux hosts).
- **Branching:** feature branches → `dev`; release tags cut from `dev` and land
  on `main` (PRD convention).
- **No telemetry** anywhere in build or runtime (NFR-9).

---

## 13. Dependency-Ordered Task Checklist

A linear-ish ordering respecting dependencies. Each box is roughly one PR.

```
[ ] 0.1  pnpm workspace + shared/server/web packages + tsconfig refs
[ ] 0.2  ESLint/Prettier/Vitest; build+test scripts
[ ] 0.3  Dockerfile (multi-stage) + reference docker-compose.yml
[ ] 0.4  shared/protocol + shared/config stubs (protocol_version=1)
[ ] 0.5  CI workflow: lint/typecheck/test/build on PR→dev
        ── M0 gate ──
[ ] 1.1  ConfigService: load + validate + hot-reload + last-good fallback
[ ] 1.2  /api/v1/health + /api/v1/config; structured logging
[ ] 1.3  config.example/ defaults + docs/config-reference.md
[ ] 1.4  web shell: focus engine scaffold + TV-safe theme + render rows
        ── M0 exit: UI shell served, config hot-reloads ──
[ ] 2.1  CatalogService + GET /api/v1/services
[ ] 2.2  web service grid (artwork, grouping, focus)
[ ] 2.3  launch flow (navigate kiosk to launch_url)
[ ] 2.4  Home/Back interception + reserved home action  ★ must-pass test
[ ] 2.5  ControlService + WS /control/ws + state broadcast + REST mirror
[ ] 2.6  keyboard handler → actions (configurable bindings)
[ ] 2.7  community-catalog seed (services.d/*) + compat notes
        ── M1 exit: launch + reliable return + WS state ──
[ ] 3.1  LibraryService folder scan + SQLite index + naming detection
[ ] 3.2  /api/v1/library + /api/v1/library/:id
[ ] 3.3  web library browse + item detail
[ ] 3.4  stream endpoint: direct-play (range) + ffmpeg transcode fallback
[ ] 3.5  player UI: play/pause/seek/stop + resume
[ ] 3.6  subtitles (embedded + sidecar)
[ ] 3.7  GPU opt-in docs; CPU fallback verified
        ── M2 exit: local media plays (direct/transcode), resume, subs ──
[ ] 4.1  MetadataService interface + TMDB provider (user key)
[ ] 4.2  normalized model in shared/models
[ ] 4.3  cache + graceful no-provider degradation
[ ] 4.4  apply metadata to tiles/library
[ ] 4.5  stub search surface (local results)
        ── M3 exit: artwork/metadata shown, degrades gracefully ──
[ ] 5.1  freeze + version protocol; write docs/protocol.md
[ ] 5.2  configurable keybindings end-to-end
[ ] 5.3  optional shared-token auth (reserved field wired)
[ ] 5.4  health/logs/log-level finalized
[ ] 5.5  Windows + Linux kiosk auto-launch docs + scripts/kiosk
[ ] 5.6  host parity verification (path mapping, GPU notes)
[ ] 5.7  performance pass vs NFR-1..3
        ── M4 exit: protocol documented/stable; hosts verified ──
[ ] 6.1  Must-FR audit; Should triage
[ ] 6.2  docs complete (README quickstart, deployment, catalog)
[ ] 6.3  publish image (version + latest)
[ ] 6.4  tag v1.0 on main
        ── v1.0 ──
```

★ = the Home/Back guarantee, the single highest-risk behavioral requirement.

---

## 14. Risk Register (Implementation)

| Risk | Phase | Mitigation |
|---|---|---|
| Home/Back interception unreliable across services | 2 | Own key capture in the display client *before* keys reach the loaded page; dedicated must-pass E2E; document any service-specific quirks in the catalog. |
| Transcode latency / quality on a low-power mini-PC | 3 | Direct-play first (ffprobe gate); sane H.264/AAC target; GPU opt-in; measure against NFR-3. |
| Windows/WSL2 path mapping & GPU passthrough pain | 3,5 | Treat CPU transcode as the guaranteed path; document Linux as the smoother GPU route; explicit host matrix tests. |
| TMDB key/licensing or rate limits | 4 | User supplies their own key; cache aggressively; fully usable with no provider. |
| Seam erosion (web importing server internals) | all | Workspace boundaries + TS project references + lint rule forbidding cross-imports; only `shared` is common. |
| Scope creep into full Aggregator (B) | 4 | Ship B *foundation* only (normalized model + stub search); unified-search UI is explicitly v1.x (PRD §22/§23). |
| Config errors crashing the UI | 1 | Validate + last-good fallback + non-fatal UI banner; explicit NFR-4 test. |

---

## 15. Definition of Done — v1.0

v1.0 ships when, on both a Windows-Docker and a Linux-Docker host:

- `docker-compose up` yields a working 10-foot home screen from host-mapped YAML
  (FR-S1, FR-CFG1).
- Service tiles launch their web players and **Home/Back always returns**
  (FR-A1–A3, NFR-5).
- Local media browses and plays (direct or transcoded), with resume and
  subtitles (FR-C1–C7).
- Tiles and library show metadata/artwork, degrading gracefully without a
  provider key (FR-B1–B2, §13).
- The keyboard drives everything via the documented, versioned **HTTP + WS
  control protocol** (FR-R1–R5, §11), published in `docs/protocol.md`.
- Health endpoint, structured logs, **zero telemetry** (FR-S2, FR-S4, NFR-9).
- Windows + Linux kiosk auto-launch is documented with example scripts
  (FR-S3, §14.2).
- All **Must** functional requirements pass; NFR performance targets met;
  release tagged on `main` and image published.

---

*This plan is a living document. Changes should be proposed via PRs targeting
`dev`, with design artifacts in `designs/` and all documentation in `docs/`,
consistent with the repo conventions and the PRD.*
