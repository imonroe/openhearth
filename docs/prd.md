# OpenHearth — Product Requirements Document

> A Docker-native, open-source, ad-free streaming hub for your living room.
> Unifies your subscription services and your own media library behind one
> remote-friendly, TV-optimized interface — without the ads, tracking, or
> corporate agenda of a commercial streaming box.

| | |
|---|---|
| **Document status** | Draft v1.0 (initial PRD) |
| **Last updated** | 2026-06-23 |
| **Owner** | Ian Monroe (`imonroe`) |
| **Domain** | open-hearth.com |
| **Repository** | `imonroe/openhearth` |
| **Companion repos** | `imonroe/openhearth-remote` (future, out of scope) |
| **Target release** | v1.0 ("the launcher + player foundation") |

---

## Table of Contents

1. [Overview & Purpose](#1-overview--purpose)
2. [Problem Statement](#2-problem-statement)
3. [Goals & Non-Goals](#3-goals--non-goals)
4. [Target Users & Personas](#4-target-users--personas)
5. [Product Scope](#5-product-scope)
6. [Conceptual Model: Three Content Strategies](#6-conceptual-model-three-content-strategies)
7. [System Architecture](#7-system-architecture)
8. [Technology Stack Decisions](#8-technology-stack-decisions)
9. [Functional Requirements](#9-functional-requirements)
10. [Configuration System](#10-configuration-system)
11. [Remote-Control Protocol](#11-remote-control-protocol)
12. [Local Media & Transcoding](#12-local-media--transcoding)
13. [Metadata & Discovery](#13-metadata--discovery)
14. [Display Client & Kiosk](#14-display-client--kiosk)
15. [Deployment & Operations](#15-deployment--operations)
16. [Non-Functional Requirements](#16-non-functional-requirements)
17. [Security & Privacy](#17-security--privacy)
18. [Constraints & Known Caveats](#18-constraints--known-caveats)
19. [Success Metrics](#19-success-metrics)
20. [Release Plan & Milestones](#20-release-plan--milestones)
21. [Risks & Mitigations](#21-risks--mitigations)
22. [Open Questions — Resolved](#22-open-questions--resolved)
23. [Future Work](#23-future-work)
24. [Glossary](#24-glossary)

---

## 1. Overview & Purpose

OpenHearth is a self-hosted application that turns any HDMI-connected mini-PC
into a clean, fast, ad-free streaming hub. It combines three things behind one
TV-optimized, remote-driven interface:

- A **launcher** for your commercial subscription services (Netflix, Max,
  Disney+, YouTube, etc.).
- A **cross-service brain** that helps you find what to watch (full vision is a
  v1.x/v2 goal; v1 ships the foundation).
- A **native player** for your own local and self-hosted media, ad-free end to
  end.

All open source, all configurable, all under the user's control.

**The honest promise:** OpenHearth itself shows no ads, tracks nothing, and
promotes nothing. For your own media it is fully ad-free end to end. For
commercial services it is a clean launcher into their own players — it cannot
and does not claim to strip ads from inside Netflix or YouTube, but it removes
every ad and dark pattern that a Roku-style box layers *on top*.

This PRD is the foundation for v1 implementation. It resolves the open design
questions from the project overview into concrete, buildable requirements.

---

## 2. Problem Statement

The streaming-box market is consolidating around advertising. As platforms like
Roku are absorbed into large media conglomerates, the device that should simply
be a neutral *gateway* to your content increasingly becomes an ad-delivery
surface and a data-collection endpoint. The home screen — the most valuable
real estate in the living room — gets sold to the highest bidder, and the
user's own subscriptions and media take a back seat to whatever the platform
owner wants to promote.

Strip away the ads and the agenda, and what a streaming box actually *does* is
mundane and modest: it presents a grid of services, launches the one you pick,
and (sometimes) helps you find something to watch across them. That core
function does not require an ad business, a walled garden, or a phone-home
telemetry pipeline.

**OpenHearth is that core function, rebuilt as software you own and run
yourself.**

---

## 3. Goals & Non-Goals

### 3.1 Product Goals

| # | Goal | Rationale |
|---|------|-----------|
| G1 | Replace a Roku/Fire TV-style launcher with a self-hosted, ad-free equivalent | Core value proposition |
| G2 | Launch commercial services reliably in a kiosk browser, with a guaranteed return path | "Replace the box completely" requires reliable Home/Back |
| G3 | Play local/self-hosted media natively, ad-free, with transcoding fallback | The one place OpenHearth is a *true* player |
| G4 | Be configurable entirely from host-mapped YAML | Homelab-native, no DB-locked settings |
| G5 | Expose a clean, documented remote-control protocol | The unlock for future phone remote & multi-device |
| G6 | Run as a single `docker-compose up` on Windows and Linux hosts | Lowest-friction adoption for the target user |

### 3.2 Engineering Goals

- Maintain a **clean seam between "brain" (server) and "face" (display
  client)** so remotes and multi-device setups are additive, not rewrites.
- Keep the **service catalog declarative and shareable** so users aren't all
  rewriting the same Netflix tile.
- Ship **sensible defaults** so a first run works before any config editing.

### 3.3 Non-Goals (v1)

- **Stripping ads from inside commercial services.** Impossible and never
  claimed; DRM is a hard wall.
- **A non-technical setup wizard / GUI configuration.** v1 assumes a user happy
  to edit YAML.
- **The phone-remote app.** Separate repo (`openhearth-remote`), built later
  against the v1 control endpoint.
- **Full cross-service unified search & watchlists.** The discovery foundation
  ships in v1; the full Aggregator experience is v1.x+.
- **Deep Plex/Jellyfin integration** beyond basic library reads.
- **A tested/documented multi-device path** (server on NAS, kiosk on a Pi).
  Supported by the architecture, not a v1 deliverable.

---

## 4. Target Users & Personas

### 4.1 Primary Persona (v1): "The Homelabber"

Comfortable with `docker-compose`, editing YAML config files, and wiring up a
mini-PC. Already runs things like Jellyfin, Plex, Home Assistant, or a NAS, and
wants their streaming front-end to live in that same self-hosted, ad-free
world.

- **Needs:** A neutral launcher; native playback of their own library; full
  control via files; no telemetry.
- **Tolerates:** Editing YAML, mapping volumes, reading docs, occasional
  troubleshooting of kiosk/GPU quirks.
- **Will not tolerate:** Ads, accounts, phone-home, a closed black box.

### 4.2 Explicitly Not v1: "The Cord-Cutter"

Non-technical user who needs a polished setup wizard and never touches a config
file. May come later; designing for them now would balloon scope. v1 assumes a
user who is happy to map a `config/` directory and edit YAML.

---

## 5. Product Scope

### 5.1 In Scope for v1

- Docker-compose deployment with a host-mapped `config/` directory.
- YAML-configured grid of commercial services, launched in the kiosk browser.
- Reliable **Home/Back** return from a launched service.
- Native playback of local media via browser, with **ffmpeg transcoding
  fallback**.
- Basic metadata/artwork for service tiles and the local library.
- A documented **remote-control endpoint** (HTTP + WebSocket).
- Configuration hot-reload where practical.
- First-class **Windows** and **Linux** host support.

### 5.2 Out of Scope for v1 (Candidate Future Work)

- The phone-remote app (separate repo).
- Full cross-service unified search and watchlists.
- Plex/Jellyfin deep integration beyond basic library reads.
- A non-technical setup wizard / GUI configuration.
- Tested/documented multi-device deployment.

---

## 6. Conceptual Model: Three Content Strategies

OpenHearth handles three categories of content with three different strategies.
**This is the core conceptual model of the whole project.**

| Content type | Strategy | What OpenHearth does |
|---|---|---|
| Commercial subscription services (Netflix, Max, Disney+, YouTube, etc.) | **Launcher (A)** | Presents them as tiles. On select, navigates the kiosk browser to the service's own web player. Hands off; never touches the stream. |
| Cross-service discovery | **Aggregator (B)** | Unified search, watchlists, and "what's on which service" using third-party metadata (e.g. TMDB / JustWatch-style data). Launch still hands off to the real player. |
| Your own media (local files, Jellyfin, Plex) | **Player (C)** | Plays it natively in the interface, transcoding on the fly where needed. Fully ad-free, fully under your control. |

**The honest boundary:** **A + B** make the commercial side pleasant without
pretending to do the impossible (you can't legally decode DRM-wrapped
commercial streams). **C** is where OpenHearth is a true, native, ad-free
player — for the content you actually own or self-host.

**v1 delivery:** A is fully delivered. C is fully delivered. B ships only its
**foundation** — the metadata pipeline and data model needed to light up the
full Aggregator experience in v1.x — not the unified-search UI itself.

---

## 7. System Architecture

Even though v1 runs on a single box, the system is two logically distinct
pieces. Keeping this seam clean from day one is what makes the phone remote and
multi-device setups possible later without a rewrite.

### 7.1 The OpenHearth Server (the Docker container) — "the brain"

Responsibilities:

- Serves the web UI (the 10-foot front-end).
- Reads and watches the YAML configuration (services, layout, library paths,
  key bindings).
- Indexes the local/self-hosted media library.
- Talks to external metadata APIs for artwork and cross-service discovery.
- Bundles **ffmpeg** for on-the-fly transcoding of local media.
- Exposes a **remote-control endpoint** (HTTP + WebSocket) that any client —
  keyboard handler, future phone app — drives.

### 7.2 The OpenHearth Display Client (the kiosk browser) — "the face"

A Chromium instance in kiosk mode (`--kiosk --app=...`) pointed at the server,
rendering the 10-foot UI fullscreen on the HDMI display. On Windows this is a
kiosk shortcut, ideally auto-launching on boot. Local media plays here via the
HTML5 `<video>` element; the server transcodes anything the browser can't play
directly. Commercial services load here too, by navigating the same kiosk
browser to their web players.

> **Note on local playback:** "Bundle VLC/ffmpeg" in practice means *ffmpeg in
> the container for transcoding, playback in the browser* — the Jellyfin model.
> There is no embedded native VLC window; the container can't easily push video
> to the host display (especially under Windows/WSL2), so the browser client is
> the renderer.

### 7.3 Architecture Diagram (logical)

```
   ┌──────────────────────────── Host (mini-PC, Windows/Linux) ────────────────────────────┐
   │                                                                                        │
   │   ┌──────────────── Docker ────────────────┐         ┌──────── Chromium kiosk ───────┐ │
   │   │  OpenHearth Server ("brain")            │  HTTP   │  Display Client ("face")      │ │
   │   │                                         │◄───────►│                               │ │
   │   │  • Web UI host (static + API)           │   WS    │  • Renders 10-foot UI         │ │
   │   │  • Config loader/watcher (YAML)         │◄───────►│  • HTML5 <video> playback     │ │
   │   │  • Library indexer                      │         │  • Navigates to web players   │ │
   │   │  • Metadata clients (TMDB, etc.)        │  HLS/   │  • Captures key events ──────►│ │
   │   │  • ffmpeg transcoder                    │  MP4    │                               │ │
   │   │  • Remote-control endpoint (HTTP+WS)    │────────►│                               │ │
   │   └──────────────┬──────────────────────────┘         └───────────────┬───────────────┘ │
   │                  │                                                     │ HDMI            │
   │   host-mapped    │                                            ┌────────▼────────┐        │
   │   volumes:       │                                            │   TV / Display   │        │
   │   • /config (YAML)                                            └──────────────────┘        │
   │   • /media   (read)                                                                       │
   │   • /cache   (artwork, transcode segments)                                                │
   └──────────────────────────────────────────────────────────────────────────────────────────┘
                          ▲
                          │ HTTP/WS (same protocol)
                  ┌───────┴────────┐
                  │ Future clients │  ← openhearth-remote phone app, second kiosk, etc.
                  └────────────────┘
```

### 7.4 Component Seam Contract

The server and client communicate **only** over documented HTTP + WebSocket
APIs. No client-specific server logic. The keyboard handler in the kiosk and a
future phone app are both *just clients* of the same control endpoint. This is
guiding principle #4 ("a clean seam between brain and face") expressed as an
architectural rule.

---

## 8. Technology Stack Decisions

> Resolves Open Question #1.

### 8.1 Server: **Node.js (TypeScript) + Fastify**

| Decision | Choice | Rationale |
|---|---|---|
| Language/runtime | **Node.js 20 LTS, TypeScript** | One language across server and browser front-end; huge ecosystem for media (ffmpeg wrappers, HLS), config (YAML), and WebSockets; the target audience already runs Node-based homelab tooling. |
| HTTP framework | **Fastify** | Fast, schema-first (JSON Schema validation we reuse for the control protocol), first-class WebSocket support via `@fastify/websocket`. |
| WebSocket | `@fastify/websocket` (ws) | Single server process handles both REST and WS. |
| Config parsing | `yaml` + `chokidar` (file watching) | Human-first YAML, hot-reload via watcher. |
| Schema validation | JSON Schema (Ajv, bundled with Fastify) | Validate both config and control-protocol messages. |
| Transcoding | **ffmpeg** (system binary in image) driven via child process | Industry standard; the Jellyfin model. |

**Alternatives considered:** Go (great single-binary distribution, but a second
language vs. the browser front-end and a thinner media/metadata library
ecosystem); Python (excellent libraries but heavier containers and weaker
typed-contract story for the shared protocol). Node+TS wins on
**one-language-everywhere** and ecosystem fit for this specific workload.

### 8.2 Front-End (10-foot UI): **React + TypeScript + Vite**

| Decision | Choice | Rationale |
|---|---|---|
| Framework | **React 18 + TypeScript** | Mature, well-understood; shared types with the server. |
| Build tool | **Vite** | Fast builds, simple static output served by the server. |
| Spatial navigation | **Custom focus engine** (or a vetted lib such as a Norigin-spatial-navigation-style approach) | 10-foot UIs are driven by directional keys; we need explicit, predictable focus management, not mouse-first interaction. |
| Styling | CSS modules / utility CSS, large type, high contrast | TV-safe area, readable from 10 feet. |
| State | Lightweight store (Zustand or React context) | Avoid heavyweight state machinery for a focused UI. |

**Front-end is a static bundle** served by the server. It is the canonical
"face" rendered by the kiosk. It must remain a pure client of the control/API
endpoints (no privileged server coupling).

### 8.3 Persistence

- **Config:** YAML files in the host-mapped `config/` volume. The source of
  truth for user-tweakable settings (services, layout, library paths,
  keybindings).
- **Index/cache:** An embedded **SQLite** database in a `cache/` volume for the
  media index, metadata cache, and artwork references. This is a *derived
  cache*, never the source of truth — it can be deleted and rebuilt. (No
  database-locked settings; this honors the configuration philosophy.)
- **Artwork/transcode segments:** files under `cache/`.

### 8.4 Container Image

- Base: a slim Node 20 image with **ffmpeg** installed (and the codec set
  needed for common transcodes).
- Single service in `docker-compose.yml` for v1 (server + bundled static UI).
- GPU transcoding (VAAPI/NVENC/QSV) is **opt-in** via device mapping and
  documented per-host.

---

## 9. Functional Requirements

Requirements use **MoSCoW** priority: **M**ust, **S**hould, **C**ould.
IDs are stable references for implementation and tracking.

### 9.1 Service Launcher (Strategy A)

| ID | Priority | Requirement |
|---|---|---|
| FR-A1 | Must | Render a grid of service tiles defined in YAML (name, launch URL, icon/artwork, optional ordering/grouping). |
| FR-A2 | Must | On tile select, navigate the kiosk browser to the service's web player URL. |
| FR-A3 | Must | Provide a reserved **Home/Back** action that always returns from a launched service back into the OpenHearth UI. |
| FR-A4 | Must | Support per-service launch URL overrides (e.g. deep-link to a profile or a specific app path). |
| FR-A5 | Should | Ship a curated **community catalog** of common service definitions users can reference/import. |
| FR-A6 | Should | Allow tile artwork from a local file, a URL, or a metadata-provider fallback. |
| FR-A7 | Could | Per-service user-agent / window hints to improve kiosk compatibility. |

### 9.2 Local Media Player (Strategy C)

| ID | Priority | Requirement |
|---|---|---|
| FR-C1 | Must | Scan one or more host-mapped library folders for video/audio files. |
| FR-C2 | Must | Present the local library as browsable tiles with artwork and basic metadata (title, year, poster). |
| FR-C3 | Must | Play supported media natively via HTML5 `<video>`. |
| FR-C4 | Must | Transcode on the fly via ffmpeg when the browser can't play a file/codec directly. |
| FR-C5 | Must | Support play / pause / seek / stop, and resume from last position. |
| FR-C6 | Should | Detect basic library structure (Movies, TV with season/episode) from folder/file naming conventions. |
| FR-C7 | Should | Support subtitle tracks (embedded and sidecar `.srt`/`.vtt`). |
| FR-C8 | Could | Read-only ingest from a Jellyfin/Plex library API (basic library reads only). |

### 9.3 Discovery Foundation (Strategy B — foundation only in v1)

| ID | Priority | Requirement |
|---|---|---|
| FR-B1 | Must | Fetch and cache artwork/metadata for service tiles and local library from a metadata provider. |
| FR-B2 | Should | Maintain a normalized internal metadata model (title, IDs, art, availability) that a future unified search can query. |
| FR-B3 | Could | Stub a search API surface returning local-library results (extensible to cross-service later). |

### 9.4 Configuration

| ID | Priority | Requirement |
|---|---|---|
| FR-CFG1 | Must | Load all user settings from host-mapped YAML in `config/`. |
| FR-CFG2 | Must | Validate config against a published schema and surface clear errors (without crashing the whole UI). |
| FR-CFG3 | Must | Ship sensible defaults so a first run works before any editing. |
| FR-CFG4 | Should | Hot-reload config changes without a full container restart where practical. |
| FR-CFG5 | Should | Provide an example/annotated `config/` on first run. |

### 9.5 Remote Control & Input

| ID | Priority | Requirement |
|---|---|---|
| FR-R1 | Must | Map standard keyboard keypresses to navigation and playback actions. |
| FR-R2 | Must | Expose a documented HTTP + WebSocket control endpoint that drives the same actions. |
| FR-R3 | Must | Reserve a Home/Back binding that returns from any launched service. |
| FR-R4 | Should | Make key bindings configurable in YAML. |
| FR-R5 | Should | Broadcast UI/playback state over WebSocket so any client can reflect current context. |

### 9.6 System / Operability

| ID | Priority | Requirement |
|---|---|---|
| FR-S1 | Must | Run via a single `docker-compose up` with documented volumes and ports. |
| FR-S2 | Must | Provide a health/readiness endpoint. |
| FR-S3 | Should | Document a reliable kiosk auto-launch-on-boot path for Windows and Linux. |
| FR-S4 | Should | Emit structured logs to stdout (no telemetry, no phone-home). |

---

## 10. Configuration System

> Resolves Open Question #3 (service-definition format) and #4 (local-media
> scope).

### 10.1 Directory Layout

```
config/
├── openhearth.yaml        # top-level: UI, library paths, keybindings, metadata
├── services.yaml          # the service tile catalog (Strategy A)
└── services.d/            # optional: drop-in service definitions / community catalog
    ├── netflix.yaml
    └── youtube.yaml
```

`config/` is host-mapped. The user edits these directly. A derived SQLite cache
lives separately in `cache/` and is never hand-edited.

### 10.2 Top-Level Config (`openhearth.yaml`)

```yaml
ui:
  title: "OpenHearth"
  theme: dark
  rows:                      # ordered layout of the home screen
    - { type: services, group: "Streaming" }
    - { type: library, source: movies }
    - { type: library, source: tv }

library:
  sources:
    - id: movies
      label: "Movies"
      path: /media/movies     # host-mapped read-only volume
      kind: movies            # movies | tv | music | mixed
    - id: tv
      label: "TV"
      path: /media/tv
      kind: tv
  # v1 default is plain folder scan. Jellyfin/Plex are optional, read-only.
  integrations: []
  #  - type: jellyfin
  #    url: http://jellyfin.local:8096
  #    api_key: "${JELLYFIN_API_KEY}"

metadata:
  provider: tmdb              # see §13
  api_key: "${TMDB_API_KEY}"
  language: en-US

keybindings:                 # see §11.4
  up: ["ArrowUp"]
  down: ["ArrowDown"]
  left: ["ArrowLeft"]
  right: ["ArrowRight"]
  select: ["Enter"]
  back: ["Backspace", "Escape"]
  home: ["Home"]             # reserved: always returns to OpenHearth
  play_pause: [" "]
```

### 10.3 Service Definition Schema (`services.yaml` / `services.d/*.yaml`)

> Resolves Open Question #3.

A service tile is a few lines of YAML — `name`, `launch URL`, `icon` — exactly
as the overview requires. Adding a service is declarative and shareable.

```yaml
services:
  - id: netflix              # unique, stable identifier
    name: "Netflix"          # display name
    launch_url: "https://www.netflix.com/"
    icon: "netflix.png"      # path in config/, a URL, or omit for metadata fallback
    group: "Streaming"       # optional grouping/row
    order: 10                # optional sort hint
    # optional kiosk compatibility hints:
    user_agent: null
    notes: null

  - id: youtube
    name: "YouTube"
    launch_url: "https://www.youtube.com/tv"   # TV-optimized endpoint where one exists
    icon: "youtube.png"
    group: "Streaming"
    order: 20
```

**Field reference:**

| Field | Required | Type | Notes |
|---|---|---|---|
| `id` | yes | string | Unique, stable. |
| `name` | yes | string | Display label on the tile. |
| `launch_url` | yes | URL | Where the kiosk navigates on select. |
| `icon` | no | path/URL | Local file in `config/`, remote URL, or omitted (metadata fallback). |
| `group` | no | string | Row/section grouping. |
| `order` | no | int | Sort hint within a group. |
| `user_agent` | no | string | Optional UA override for kiosk compatibility. |
| `notes` | no | string | Human notes; ignored by the app. |

**Community catalog:** A maintained set of `services.d/*.yaml` definitions (the
shareable catalog from the overview) ships in-repo under `docs/` examples and
can be referenced/copied by users. This avoids everyone re-authoring the same
Netflix tile.

### 10.4 Local-Media Scope for v1

> Resolves Open Question #4.

**v1 default is a plain folder scan.** Jellyfin/Plex integration is **optional
and read-only** (basic library reads only) and is a **Should**, not a Must —
the foundation is present (`library.integrations`) but plain folder scanning is
the guaranteed, tested path. This keeps v1 scope bounded while leaving the
clean extension point.

### 10.5 Validation & Hot-Reload

- All config is validated against a published JSON Schema on load.
- Invalid config produces a **clear, surfaced error** and falls back to the
  last-good config where possible — it never silently fails or hard-crashes the
  UI.
- The server watches `config/` (chokidar) and hot-reloads where practical
  (service catalog, layout, keybindings). Changes requiring a restart (e.g.
  bind port) are documented as such.

---

## 11. Remote-Control Protocol

> Resolves Open Question #5. This is the contract the keyboard handler and the
> future `openhearth-remote` phone app both depend on. It lives in this repo
> and is versioned.

### 11.1 Design Principles

- **Transport-symmetric:** the same logical actions are available over REST
  (request/response) and WebSocket (event stream + commands).
- **Client-agnostic:** no command is keyboard-specific or phone-specific.
- **Stateless commands, stateful broadcast:** clients send commands; the server
  broadcasts authoritative state so every client stays in sync.
- **Versioned:** the protocol carries a version; breaking changes bump it.

### 11.2 REST Surface (representative)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/health` | Liveness/readiness. |
| `GET` | `/api/v1/config` | Effective (validated) config snapshot. |
| `GET` | `/api/v1/services` | Service tile catalog. |
| `GET` | `/api/v1/library` | Library listing (paginated). |
| `GET` | `/api/v1/library/:id` | Item detail + playback info. |
| `GET` | `/api/v1/library/:id/stream` | Direct-play or transcoded stream (HLS/MP4). |
| `POST` | `/api/v1/control/command` | Issue a control command (mirror of the WS command). |
| `GET` | `/api/v1/state` | Current UI/playback state snapshot. |

### 11.3 WebSocket Surface (`/api/v1/control/ws`)

Bidirectional JSON messages. Two channels: **commands** (client → server) and
**events** (server → all clients).

**Command message (client → server):**

```json
{
  "type": "command",
  "protocol_version": 1,
  "id": "c-8f2a",
  "action": "navigate",
  "params": { "direction": "right" }
}
```

**Event message (server → clients):**

```json
{
  "type": "event",
  "protocol_version": 1,
  "event": "state_changed",
  "state": {
    "screen": "home",
    "focus": { "row": "Streaming", "tileId": "netflix" },
    "playback": { "status": "stopped", "itemId": null, "positionSec": 0 }
  }
}
```

### 11.4 Action Vocabulary (v1)

| Action | Params | Effect |
|---|---|---|
| `navigate` | `direction: up\|down\|left\|right` | Move focus. |
| `select` | — | Activate focused element. |
| `back` | — | Go back one level within OpenHearth. |
| `home` | — | **Reserved.** Always returns to the OpenHearth home screen, including from a launched commercial service. |
| `play_pause` | — | Toggle playback. |
| `seek` | `deltaSec` or `positionSec` | Seek local playback. |
| `stop` | — | Stop playback, return to browse. |
| `launch_service` | `serviceId` | Navigate kiosk to a service web player. |
| `play_item` | `itemId` | Start local-media playback. |
| `set_volume` | `level` (0–100) | Adjust volume (where supported). |

The keyboard handler maps configured keys (§10.2 `keybindings`) onto exactly
these actions. **No action is keyboard-specific** — the phone remote will speak
the identical vocabulary.

### 11.5 The Home/Back Guarantee

`home` (and the configured Home key) is a **reserved, always-available**
binding. When a commercial service is loaded in the kiosk, the display client
intercepts the Home/Back key and returns to the OpenHearth UI rather than
letting the key fall through to the service. This is the single most important
behavioral requirement for "replace the Roku completely" (FR-A3 / FR-R3).

### 11.6 Authentication (v1)

v1 assumes a trusted LAN. The control endpoint is **unauthenticated by default
on the loopback/LAN** but **binds configurably** and ships docs warning against
exposing it to untrusted networks. An optional shared-token mode is a
**Should** (see §17). The protocol carries an auth field reserved for future
use so adding auth is non-breaking.

---

## 12. Local Media & Transcoding

### 12.1 Playback Decision Flow

```
play_item(itemId)
   │
   ├─ Probe container/codecs (ffprobe)
   │
   ├─ Browser can direct-play?  ──Yes──►  Stream file as-is (range requests, MP4/WebM)
   │                                         │
   └─No (unsupported codec/container)        ▼
        │                              HTML5 <video> in kiosk renders it
        ▼
   ffmpeg transcode to a browser-friendly target
   (e.g. H.264/AAC in fragmented MP4 or HLS),
   segment into /cache, stream to the kiosk
```

### 12.2 Requirements

- **Direct play first.** Probe with ffprobe; only transcode when necessary
  (saves CPU/GPU, preserves quality).
- **Transcode target:** browser-safe profile (H.264 + AAC, fMP4 or HLS).
- **Adaptive where practical:** support seeking into a transcoded stream
  without re-encoding from the start where feasible.
- **GPU acceleration is opt-in** and documented per-host (VAAPI on Linux,
  NVENC/QSV where available; Windows/WSL2 GPU passthrough explicitly called out
  as a known-hard area — see §18).
- **Subtitles:** embedded and sidecar `.srt`/`.vtt`, burned-in only when a
  format can't be delivered as a track.
- **Resume:** persist last playback position (in `cache/` SQLite) and offer
  resume.

### 12.3 Why Browser-Rendered (not container-side video)

Native-quality local playback routes through the browser + ffmpeg, **not** a
container-side video window. The container can't easily push video to the host
display — especially under Windows/WSL2 — so the kiosk browser is the renderer.
This is the Jellyfin model and a deliberate architectural constraint, not a
limitation to be "fixed."

---

## 13. Metadata & Discovery

> Resolves Open Question #2.

### 13.1 Provider Decision: **TMDB (primary), pluggable**

| Decision | Choice | Rationale |
|---|---|---|
| Primary provider | **TMDB (The Movie Database)** | Free API for non-commercial/attributed use, excellent artwork and metadata coverage, well-documented, widely used by Jellyfin/Kodi-class apps. |
| Availability ("what's on which service") | **Deferred to v1.x**; design the model to accept a JustWatch-style availability source later | JustWatch-style availability data has **restrictive licensing** and is the riskier dependency; the full Aggregator (B) experience that needs it is out of v1 scope anyway. |
| Architecture | **Pluggable provider interface** | Avoid lock-in; allow OMDb/Fanart.tv/local-only modes; respect users who want no external calls. |

**Licensing posture:** TMDB requires API attribution and an API key the user
supplies (their key, their terms — consistent with self-hosting and
no-phone-home). The app must function in a **degraded but usable** mode with no
metadata provider configured (titles from filenames, no external art). We do
**not** bundle or redistribute provider data; we cache the user's own fetched
results in their `cache/` volume.

### 13.2 Requirements

- Metadata fetching uses the **user's own API key** from config.
- All fetched metadata/artwork is cached locally in `cache/`.
- The app degrades gracefully with no provider (filename-derived titles).
- The normalized internal model (FR-B2) is provider-agnostic so a future
  availability source for cross-service discovery slots in without a rewrite.
- No metadata call ever sends user identity or telemetry beyond what the
  provider API inherently requires for a content lookup.

---

## 14. Display Client & Kiosk

### 14.1 Kiosk Requirements

- Chromium in kiosk mode (`--kiosk --app=http://localhost:<port>`).
- Fullscreen, no chrome, no address bar, cursor hidden when idle.
- **Auto-launch on boot** (Open Question #7, resolved below).
- Captures key events and translates them to control actions (§11.4).
- Intercepts Home/Back so it never leaks into a launched service (§11.5).

### 14.2 Auto-Launch on Boot

> Resolves Open Question #7.

| Host | Mechanism (documented, v1) |
|---|---|
| **Windows** | A Startup-folder kiosk shortcut (`chrome.exe --kiosk --app=...`) or Task Scheduler "at log on" task; auto-login configured by the user. Documented step-by-step. |
| **Linux** | A minimal X/Wayland session launching Chromium kiosk via a systemd user service or autostart entry; documented for a Debian/Ubuntu reference. |

v1 **documents** these paths thoroughly (and ships example scripts/shortcuts in
`docs/`); it does not attempt to fully automate host-OS auto-login, which is
host-specific and outside the container's reach.

### 14.3 10-Foot UI Requirements

- Designed for viewing from ~10 feet: large type, high contrast, generous
  focus indication.
- **Directional (D-pad/arrow) navigation** is the primary interaction model;
  every interactive element is reachable and clearly focus-highlighted.
- Respects TV title/action-safe areas (overscan-tolerant margins).
- Fast: home screen interactive quickly; navigation feels instant (see §16).
- Design artifacts (wireframes, focus maps, visual language) live in the
  `designs/` folder per repo convention.

---

## 15. Deployment & Operations

### 15.1 docker-compose (reference)

```yaml
services:
  openhearth:
    image: ghcr.io/imonroe/openhearth:latest
    container_name: openhearth
    ports:
      - "8080:8080"            # web UI + API + WS
    volumes:
      - ./config:/config       # host-mapped YAML (read/write)
      - /path/to/media:/media:ro   # library source(s), read-only
      - ./cache:/cache         # derived index/artwork/transcode cache
    environment:
      - TMDB_API_KEY=${TMDB_API_KEY}
    # GPU transcoding is opt-in and host-specific; documented separately.
    # devices:
    #   - /dev/dri:/dev/dri    # Linux VAAPI example
    restart: unless-stopped
```

### 15.2 Linux as a Co-Equal Target

> Resolves Open Question #6.

Linux is a **first-class, co-equal target**, not an afterthought — and is
likely the simpler path. Both Windows-with-Docker and a Debian/Ubuntu reference
host are documented and tested for v1. Windows is the author's reference rig;
Linux is treated as equally supported, with GPU transcoding actually easier
there (VAAPI/`/dev/dri`).

### 15.3 Operability

- **Health endpoint** (`/api/v1/health`) for readiness checks.
- **Structured stdout logs**, log-level configurable; **no telemetry**.
- Clear startup diagnostics: config validation results, library scan summary,
  metadata provider reachability.
- Versioned image tags + `latest`; documented upgrade path (config is
  forward-compatible; cache is disposable).

---

## 16. Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Performance | Home screen interactive within ~2s of kiosk load on the reference mini-PC. |
| NFR-2 | Performance | Focus navigation responds within ~100ms (feels instant on a TV). |
| NFR-3 | Performance | Local direct-play starts within ~2s; transcoded play within ~5s. |
| NFR-4 | Reliability | Invalid config never hard-crashes the UI; falls back to last-good where possible. |
| NFR-5 | Reliability | Home/Back return works 100% of the time from a launched service. |
| NFR-6 | Portability | Identical behavior on Windows-Docker and Linux-Docker hosts (modulo documented GPU differences). |
| NFR-7 | Resource | Idle footprint modest enough for a low-power mini-PC; transcoding scales with available CPU/GPU. |
| NFR-8 | Maintainability | Server and client communicate only via the documented, versioned API (the seam contract). |
| NFR-9 | Privacy | Zero phone-home; no analytics; no outbound calls except user-configured metadata lookups. |
| NFR-10 | Accessibility | High-contrast, large-type defaults; configurable theme. |

---

## 17. Security & Privacy

- **No phone-home, no telemetry, no accounts.** A first-class product promise
  (guiding principle #2).
- **Trusted-LAN default.** v1 targets a home LAN. The control endpoint binds
  configurably; docs strongly warn against exposing it to untrusted networks or
  the public internet.
- **Optional shared-token auth (Should).** A simple token gate for the API/WS
  for users on shared/untrusted LANs; protocol reserves an auth field so this
  is additive.
- **Secrets via env/`${VAR}` interpolation**, not committed to config; document
  `.env` usage and `config/` gitignore guidance.
- **Read-only media mounts** by default.
- **Outbound calls are user-configured only** (the metadata provider, with the
  user's own key) — and the app is fully usable with them disabled.
- **No DRM circumvention.** OpenHearth launches commercial players; it never
  attempts to decode protected streams (§18).

---

## 18. Constraints & Known Caveats

- **DRM is a hard wall.** Commercial services are Widevine/PlayReady-wrapped.
  OpenHearth launches their players; it does not and cannot decode them. The
  "ad-free" claim applies to OpenHearth's own surface and your own media — not
  to ad-tier content *inside* a commercial service.
- **Kiosk-browser realities.** Some services detect embedded/kiosk browsers,
  and Widevine **L3** may cap playback resolution in a generic Chromium. Real,
  not fatal — documented for users, with per-service compatibility notes in the
  community catalog.
- **Container-to-display video.** Native-quality local playback routes through
  the browser + ffmpeg, not a container-side video window, for the reasons in
  §7.2 / §12.3.
- **Windows/WSL2 quirks.** The reference host is Windows; path mapping, Docker
  networking, and especially **GPU transcoding access** need explicit attention
  and are documented as known-hard. Linux is the smoother GPU path.
- **Legal boundary.** OpenHearth is a launcher + personal-media player. It
  ships no commercial content and circumvents no protection.

---

## 19. Success Metrics

Because the product is privacy-first and collects **no telemetry**, success is
measured by community and qualitative signals, not phone-home analytics:

| Metric | Target signal |
|---|---|
| "Replaces my Roku" | Users report fully replacing a commercial box for daily living-room use. |
| Setup friction | A homelabber can go from `docker-compose up` to a working home screen by following the docs without hitting a wall. |
| Home/Back reliability | Zero reports of being "stuck" inside a launched service. |
| Local playback success | Common library formats play (direct or transcoded) without manual intervention. |
| Community catalog growth | Service definitions contributed by users (shareable catalog adoption). |
| Project health | GitHub stars/forks/issues engagement; contributor PRs. |

---

## 20. Release Plan & Milestones

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 — Skeleton** | Repo scaffolding, container, config loader, health endpoint, empty 10-foot UI shell. | `docker-compose up` serves a UI; config validates; health green. |
| **M1 — Launcher (A)** | Service tiles from YAML, kiosk launch, **Home/Back guarantee**, keyboard nav. | Can launch & reliably return from a real service. |
| **M2 — Player (C)** | Library scan, browse, direct play, ffmpeg transcode fallback, resume, subtitles. | Common formats play; transcode fallback works. |
| **M3 — Metadata (B foundation)** | TMDB integration, artwork/metadata cache, normalized model. | Tiles & library show artwork/metadata; degrades gracefully without a key. |
| **M4 — Protocol & polish** | Documented, versioned HTTP+WS control endpoint; configurable keybindings; logs; docs (Windows + Linux auto-launch). | Protocol documented & stable; both host paths documented. |
| **v1.0 release** | All Musts across M1–M4 met; docs complete; example config + community catalog seed. | Tagged release on `main`; image published. |

**Branching convention (per repo rules):** feature branches target **`dev`**;
only tagged releases live on **`main`**.

---

## 21. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Kiosk browsers detected/blocked by services | Med | Med | Per-service UA hints + compatibility notes in catalog; document Widevine L3 caps. |
| Windows/WSL2 GPU transcode pain | High | Med | Document CPU-only fallback as the guaranteed path; GPU is opt-in; Linux as smoother alternative. |
| Metadata provider licensing/availability data | Med | Med | TMDB primary with user's own key; defer JustWatch-style availability; pluggable providers; usable with none. |
| Home/Back interception unreliable | Low | High | Treat as a Must with explicit tests; the display client owns key interception before keys reach the service. |
| Scope creep into Aggregator/B | Med | Med | v1 ships B *foundation* only; full unified search explicitly v1.x. |
| Non-technical users arrive early | Med | Low | Clear positioning: v1 is homelabber-targeted; wizard is future work. |

---

## 22. Open Questions — Resolved

The overview listed seven decisions to resolve. This PRD resolves them:

| # | Question | Resolution (see section) |
|---|---|---|
| 1 | Tech stack | **Node.js + TypeScript + Fastify** server; **React + TypeScript + Vite** 10-foot UI. (§8) |
| 2 | Metadata source | **TMDB primary**, pluggable; JustWatch-style availability deferred to v1.x due to licensing. (§13) |
| 3 | Service-definition format | Declarative YAML (`id`, `name`, `launch_url`, `icon`, …) with `services.d/` drop-ins + community catalog. (§10.3) |
| 4 | Local-media scope for v1 | **Plain folder scan** is the guaranteed path; Jellyfin/Plex read-only is optional/Should. (§10.4) |
| 5 | Remote-control protocol shape | Versioned **HTTP + WebSocket**, transport-symmetric, client-agnostic action vocabulary. (§11) |
| 6 | Linux as co-equal target | **Yes — first-class, co-equal**, documented & tested alongside Windows; smoother GPU path. (§15.2) |
| 7 | Boot/auto-launch | Documented Windows (Startup/Task Scheduler) and Linux (systemd/autostart) kiosk auto-launch; example scripts shipped. (§14.2) |

---

## 23. Future Work

Tracked but explicitly **out of v1 scope**:

- **`openhearth-remote`** — the phone remote app, a thin client of the v1
  control endpoint (separate repo).
- **Full Aggregator (B)** — cross-service unified search and watchlists,
  "what's on which service," built on the v1 metadata foundation.
- **Deep Plex/Jellyfin integration** beyond basic library reads.
- **Non-technical setup wizard / GUI configuration** — for the cord-cutter
  persona.
- **Multi-device deployments** — server on a NAS, kiosk on a separate Pi;
  supported by the seam architecture, to be tested/documented later.
- **Availability data integration** — a licensed JustWatch-style source for
  cross-service availability.

---

## 24. Glossary

| Term | Meaning |
|---|---|
| **Strategy A / Launcher** | Presenting commercial services as tiles and handing off to their web players. |
| **Strategy B / Aggregator** | Cross-service discovery (search, watchlists, availability) via third-party metadata. |
| **Strategy C / Player** | Native, ad-free playback of the user's own local/self-hosted media. |
| **Brain** | The OpenHearth server (Docker container). |
| **Face** | The OpenHearth display client (Chromium kiosk). |
| **The seam** | The documented HTTP+WS contract between brain and face; clients are interchangeable. |
| **10-foot UI** | An interface designed to be read and operated from across a living room. |
| **Home/Back guarantee** | The reserved binding that always returns to OpenHearth, even from inside a launched service. |
| **Direct play** | Streaming a media file to the browser without transcoding. |
| **Kiosk mode** | Chromium fullscreen, chrome-less, app-style display mode. |

---

*This PRD is the foundation for OpenHearth v1. It is a living document; changes
should be proposed via PRs targeting the `dev` branch, with design artifacts in
`designs/` and all documentation in `docs/`.*
