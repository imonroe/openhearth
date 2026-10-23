# OpenHearth — Slideshow / Digital Photo Frame Plan

> How we add a **slideshow** to OpenHearth so the TV doubles as a digital photo
> frame — usable both as an idle **screensaver** and as an **on-demand**
> dashboard action, with user-supplied images (uploaded through the UI or fed
> from a local folder) and a selectable **transition** system.

| | |
|---|---|
| **Document status** | Draft v1 (plan for review) |
| **Last updated** | 2026-07-23 |
| **Tracking issue** | [#164](https://github.com/imonroe/openhearth/issues/164) |
| **Companion** | [`docs/implementation_plan.md`](./implementation_plan.md), [`docs/prd.md`](./prd.md) |
| **Scope** | Post-v1.0 feature on `dev` |
| **Branching** | Feature branch → `dev`; tagged releases → `main` |

---

## Table of Contents

1. [How to Read This Document](#1-how-to-read-this-document)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [Constraints Inherited From the Architecture](#3-constraints-inherited-from-the-architecture)
4. [What Already Exists (Reuse Map)](#4-what-already-exists-reuse-map)
5. [Competing Strategies](#5-competing-strategies)
6. [Strategy Evaluation & Selection](#6-strategy-evaluation--selection)
7. [Selected Architecture in Detail](#7-selected-architecture-in-detail)
8. [Image Sources](#8-image-sources)
9. [Transition System](#9-transition-system)
10. [Data Model & Schemas](#10-data-model--schemas)
11. [Server API](#11-server-api)
12. [Web UI](#12-web-ui)
13. [Remote-Control Protocol](#13-remote-control-protocol)
14. [Security & Privacy](#14-security--privacy)
15. [Phased Implementation Plan](#15-phased-implementation-plan)
16. [Testing Strategy](#16-testing-strategy)
17. [Risk Register](#17-risk-register)
18. [Open Questions](#18-open-questions)
19. [Definition of Done](#19-definition-of-done)

---

## 1. How to Read This Document

This is a feature plan, not a PRD. It follows the house style of
[`implementation_plan.md`](./implementation_plan.md): competing strategies →
selection with rationale → architecture → dependency-ordered phases → testing →
risks → definition of done. Where it references existing code it uses real file
paths so the plan is verifiable against the tree today.

The slideshow is deliberately modeled on the **existing screensaver subsystem**
(issue #126) and the **wallpaper upload** subsystem (issue #118). Those two
features already solved the two hardest sub-problems — a full-frame idle overlay
and a secure user-image upload/serve path — so most of this plan is composition,
not invention.

---

## 2. Goals & Non-Goals

### Goals (from issue #164)

- **G1** — A slideshow that cycles through user photos on a TV, i.e. a digital
  photo frame.
- **G2** — Usable as a **screensaver** (activates on idle, dismisses on any
  interaction — reusing the existing idle machinery).
- **G3** — Usable **on demand** from the home screen (a dashboard action the
  user can activate without waiting for the idle timeout).
- **G4** — **Upload photos directly through the interface.**
- **G5** — **Feed a folder of images on the local machine** as a source.
- **G6** — A **selectable transition system** — at minimum fade, crossfade, and
  wipe between image changes.

### Non-Goals (this iteration)

- **NG1** — No server-side image processing / thumbnail generation. There is no
  `sharp`/`jimp` dependency today and the project favors a lean runtime; images
  are served as originals and sized with CSS `object-fit`. (Revisit only if
  memory on 4K panels forces it — see §17.)
- **NG2** — No cloud photo services (Google Photos, iCloud, etc.). "No
  phone-home, no telemetry" (CLAUDE.md constraint #4). Local images only.
- **NG3** — No per-image editing, cropping, captions, or albums. A flat set of
  images is the v1 model.
- **NG4** — No new protocol version bump. Any control-protocol touch is additive
  and optional (see §13); the screensaver itself is purely client-side today and
  the slideshow follows that precedent.
- **NG5** — No video slideshows. Raster still images only (raster-only is also a
  security requirement — see §14).

---

## 3. Constraints Inherited From the Architecture

These are non-negotiable and shape every decision below (from CLAUDE.md and the
existing code):

- **C1 — The seam.** `web/` never imports from `server/`; both import only from
  `shared/`. New protocol/config types live in `packages/shared`.
- **C2 — Config source of truth is host-mapped YAML under `config/`.** SQLite in
  `cache/` is derived and disposable; any code path must tolerate a cold DB.
  Uploaded photos are user data, so they live under `config/` (which survives a
  cache wipe), **not** `cache/`.
- **C3 — Config errors never crash the UI.** New config is validated by the
  shared Zod schema; invalid edits fall back to last-good; every field is
  optional (`{}` stays valid — NFR-9).
- **C4 — One focused element at all times.** Any new interactive surface obeys
  the focus engine and the amber-ring focus spec in `design-system.md`.
- **C5 — Raster-only, no SVG, path-contained file serving.** Reuse the existing
  `sendIconFile` defense-in-depth (extension allowlist + two-stage symlink
  containment + `nosniff`) and `imageBytesMatch` magic-byte validation.
- **C6 — Burn-in awareness.** The screensaver exists specifically to avoid panel
  burn-in; a slideshow of *static* images reintroduces that risk and must
  mitigate it (see §17, R1).

---

## 4. What Already Exists (Reuse Map)

| Need | Existing code to reuse | Path |
|---|---|---|
| Full-frame idle overlay + capture-phase wake | `Screensaver`, `useIdleTimer` | `packages/web/src/screensaver/` |
| Saver registry / extension point pattern | `SCREENSAVER_REGISTRY`, `resolveScreensaver` | `packages/web/src/screensaver/screensavers.ts` |
| Idle wiring (suppress during playback) | `ReadyApp` idle branch | `packages/web/src/App.tsx` (~L221-266) |
| Secure user-image **upload** (base64, size cap, magic bytes, atomic write, rollback) | `POST /api/v1/ui/wallpaper` | `packages/server/src/app.ts` (~L431-495) |
| Secure user-image **serve** (allowlist + path containment) | `sendIconFile` | `packages/server/src/app.ts` (~L110-143) |
| Config schema + write-back pattern | `screensaverConfigSchema`, `uiSettingsPatchSchema`, `applyUiSettings` | `packages/shared/src/config/index.ts`, `packages/server/src/core/ConfigService.ts` |
| Settings modal rows / focus grid | `Settings.tsx`, `ROW_LENGTHS`, `updateUiSettings` | `packages/web/src/settings/Settings.tsx` |
| Home header actions (Search, Settings) | `Header.tsx` + `App.tsx` `onSelect` header branch | `packages/web/src/home/` |
| Local-folder scan (mtime-incremental, symlink-safe) | `LibraryService.scan`, `isWithinLibraryRoots` | `packages/server/src/core/LibraryService.ts`, `app.ts` |

**Gaps that are genuinely new work:** an image source abstraction (uploads +
folders), a manifest endpoint, the slideshow overlay component, and the
transition system. Everything else is composition of the above.

---

## 5. Competing Strategies

### Strategy 1 — Slideshow as one more screensaver `type`

Add `'slideshow'` to the `SCREENSAVERS` tuple and a `SlideshowScreensaver`
component in `SCREENSAVER_REGISTRY`. The idle trigger, Settings picker, config
schema, and write-back all pick it up "for free."

- **Pros:** smallest diff; reuses 100% of the screensaver plumbing.
- **Cons:** the screensaver registry's `Component: () => ReactNode` takes no
  config, so a slideshow (which needs sources, interval, transition) can't be
  configured without widening the registry contract for *all* savers. And it
  gives **no on-demand launch** (G3) — screensavers only appear on idle. Fails
  G3 and G5 cleanly.

### Strategy 2 — Standalone slideshow subsystem, wired into both idle and an on-demand launcher (recommended)

A dedicated `ui.slideshow` config block, a server `SlideshowService` that
resolves the image set, a `GET …/slideshow/manifest` + `…/slideshow/image/:id`
API, and a web `<Slideshow>` overlay. The overlay is rendered from **two**
entry points in `App.tsx`: the existing idle branch (when the user opts the
slideshow in as their screensaver) and a new on-demand branch (launched from a
home dashboard action). Transitions are a small web-side registry mirroring the
saver registry.

- **Pros:** satisfies every goal (G1-G6); each concern lives where it belongs;
  the slideshow gets its own rich config without contaminating procedural
  savers; on-demand and screensaver modes share one component.
- **Cons:** more moving parts than Strategy 1 (a service, two endpoints, a new
  config block). Two render entry points must stay consistent.

### Strategy 3 — Slideshow as a library media kind

Treat photos as a new library `kind`, scan them into `CacheStore` as
`library_items`, add a "Photos" home row, and launch the slideshow via a
`play_item`-style flow.

- **Pros:** reuses the library grid, artwork cache, and control protocol; photos
  become first-class browsable content.
- **Cons:** heavy. Couples a simple photo frame to the DB, the metadata/artwork
  pipeline, `parseMediaPath` (which is movie/TV structured), and a protocol
  change. Uploaded photos would need to live in `cache/` semantics or a new
  disposable table, contradicting C2 (user data belongs in `config/`).
  Over-engineered for "cycle some photos."

---

## 6. Strategy Evaluation & Selection

| Criterion | S1 (saver type) | S2 (standalone) | S3 (library kind) |
|---|---|---|---|
| Satisfies G3 (on-demand) | ✗ | ✓ | ✓ |
| Satisfies G4/G5 (upload + folder) | partial | ✓ | ✓ (heavy) |
| Rich per-slideshow config | ✗ (registry contract) | ✓ | ✓ |
| Reuses existing plumbing | ✓✓ | ✓ | ✓ |
| Net new surface area | tiny | moderate | large |
| Respects C2 (user data in `config/`) | ✓ | ✓ | ✗ (awkward) |
| Risk of regressing screensaver/library | low | low | medium |

### Decision

**Strategy 2.** It is the only option that satisfies all of G1-G6 without either
crippling on-demand use (S1) or dragging the DB/metadata pipeline into a photo
frame (S3). It stays additive and disposable-cache-friendly, and it reuses the
wallpaper upload path and the screensaver idle path — the two hardest pieces —
rather than reinventing them.

Note: Strategy 2 does **not** preclude also registering a thin `'slideshow'`
entry so that the existing screensaver picker can select it; §7 folds that in as
the screensaver-integration mechanism, but the slideshow's real configuration
lives in its own `ui.slideshow` block, not in the saver registry.

---

## 7. Selected Architecture in Detail

```
config/
  slideshow/
    uploads/                 ← images uploaded through the UI (user data, persists)
  openhearth.yaml            ← ui.slideshow.{…} settings (source of truth)

/media/photos (example)      ← host-mapped read-only folder source (G5)

packages/shared/src/config/index.ts
  + slideshowConfigSchema, SLIDESHOW_TRANSITIONS, SLIDESHOW_ORDERS, …
  + slideshowUploadSchema (base64 upload body)
  + ui.slideshow wired into uiConfigSchema
  + ui.slideshow (editable subset) wired into uiSettingsPatchSchema

packages/server/src/core/SlideshowService.ts   ← NEW
  resolve(): SlideshowManifest  (union of uploads/ + configured source folders)

packages/server/src/app.ts
  GET    /api/v1/slideshow/manifest
  GET    /api/v1/slideshow/image/:id
  POST   /api/v1/slideshow/photos        (upload; modeled on wallpaper POST)
  DELETE /api/v1/slideshow/photos/:id    (remove an uploaded photo)

packages/web/src/slideshow/            ← NEW
  Slideshow.tsx                        (the overlay; idle + on-demand)
  transitions.ts                       (fade | crossfade | wipe | cut registry)
  useSlideshowManifest.ts              (fetch + poll manifest)
  slideshow.css

packages/web/src/App.tsx
  idle branch → render <Slideshow screensaver …> when slideshow-as-screensaver
  on-demand branch → render <Slideshow onExit …> when launched from home

packages/web/src/home/Header.tsx + App.tsx onSelect
  new "Slideshow" header action to launch on demand (G3)

packages/web/src/settings/Settings.tsx
  new rows: enable-as-screensaver, interval, transition, order, manage photos
```

### Two render entry points, one component

`<Slideshow>` takes a `mode` (`'screensaver' | 'ondemand'`) that only changes
its **exit** behavior:

- **Screensaver mode** installs the same capture-phase wake listener the Aurora
  saver uses (any key/mouse dismisses and consumes the event). It renders in the
  idle branch of `App.tsx`, in place of the whole screen tree, exactly where the
  Aurora saver renders today.
- **On-demand mode** does *not* wake on arbitrary input; instead **Back** and
  **Home** exit it (respecting the reserved-key contract), and other keys can
  drive next/previous/pause. It renders in a new early-return branch in
  `ReadyApp`, ordered like the other overlays.

Both modes fetch the same manifest and run the same cycling + transition engine.

### Screensaver integration mechanism

Add `'slideshow'` to the shared `SCREENSAVERS` tuple so the existing Settings
saver picker can select it and `ui.screensaver.type: slideshow` validates. In
`App.tsx`, the idle branch dispatches on the resolved saver type:

```ts
if (idle && !player) {
  return screensaver.type === 'slideshow'
    ? <Slideshow mode="screensaver" onWake={() => setIdle(false)} />
    : <Screensaver type={screensaver.type} onWake={() => setIdle(false)} />;
}
```

The procedural saver registry (`SCREENSAVER_REGISTRY`) keeps its
`() => ReactNode` contract untouched; the slideshow is special-cased here the way
the player is special-cased elsewhere in `ReadyApp`. Its configuration is read
from `ui.slideshow`, not from the registry entry. If `ui.slideshow` resolves to
zero images, screensaver mode **falls back to the default procedural saver** so
the idle screen is never blank (see §17 R4).

---

## 8. Image Sources

The slideshow's image set is the **union** of two sources, both resolved by
`SlideshowService`:

### 8.1 Uploaded photos (G4)

- Uploaded via `POST /api/v1/slideshow/photos` (base64 JSON, mirroring the
  wallpaper endpoint). Stored under `config/slideshow/uploads/` with
  collision-proof names.
- Unlike wallpaper (which keeps exactly one file), the slideshow **accumulates**
  uploads. Each upload appends; `DELETE …/photos/:id` removes one.
- User data → lives under `config/` (C2), so it survives a `cache/` wipe and is
  visible/manageable on the host filesystem.
- Same guards as wallpaper: size cap (reuse/mirror `MAX_WALLPAPER_BYTES`, e.g. a
  `MAX_SLIDESHOW_IMAGE_BYTES`), magic-byte validation via `imageBytesMatch`,
  atomic temp-file+rename, raster-only content types.

### 8.2 Local folder sources (G5)

- Declared in YAML under `ui.slideshow.sources[]`, each `{ id, label, path }`
  where `path` is a host-mapped folder (e.g. a `:/photos:ro` mount). This mirrors
  `library.sources[]` exactly and is the right precedent for "feed it a folder on
  the local machine": folders can't be chosen from the sandboxed browser, so they
  are configured, and the container only ever sees what the operator mounts.
- `SlideshowService` scans each source folder for image extensions
  (`.jpg/.jpeg/.png/.webp/.gif`), non-recursively by default with an optional
  `recursive` flag, following symlinks with the same containment check
  (`isWithinLibraryRoots`-style) used for media.
- Read-only: the folder is a source, never written to. Deleting a folder-sourced
  image is out of scope (the user manages those files on the host).

### 8.3 Resolution & identity

- Each image gets a stable opaque `id` = `sha1(sourceId + ':' + relPath)` (same
  identity scheme as `LibraryService.itemId()`), so the client never sees or
  controls a filesystem path — it requests `GET …/slideshow/image/:id`, and the
  server maps `id → (source, relPath)` and serves the file through the
  path-contained `sendIconFile` helper.
- The manifest is small (a list of ids + counts); serving is lazy per image.
- Scans are cheap and can be recomputed on demand or memoized with a short TTL /
  invalidated on config hot-reload. No `CacheStore` table is required for v1
  (the set is filesystem-derived and disposable); a cache table is a later
  optimization only if scan cost shows up.

---

## 9. Transition System

A **selectable** transition applied between image changes (G6). Implemented
entirely client-side in CSS (no server involvement, no image processing).

### 9.1 Vocabulary

Shared, validated tuple in `packages/shared/src/config/index.ts`:

```ts
export const SLIDESHOW_TRANSITIONS = ['cut', 'fade', 'crossfade', 'wipe'] as const;
export type SlideshowTransition = (typeof SLIDESHOW_TRANSITIONS)[number];
```

| id | Behavior |
|---|---|
| `cut` | Instant change (no animation). The honest "off" option. |
| `fade` | Current image fades to black, next image fades in. |
| `crossfade` | Next image fades in *over* the current one (two stacked layers, opacity swap). Default. |
| `wipe` | Next image is revealed by a moving edge (`clip-path` inset animation). |

### 9.2 Implementation shape

A `transitions.ts` registry mirrors the screensaver registry so new transitions
are one-entry additions:

```ts
export interface TransitionDef {
  id: SlideshowTransition;
  label: string;
  description: string;
  /** CSS class(es) applied to the incoming/outgoing image layers. */
  enterClass: string;
  exitClass: string;
}
export const TRANSITION_REGISTRY: Record<SlideshowTransition, TransitionDef> = { … };
export const TRANSITION_LIST = SLIDESHOW_TRANSITIONS.map((id) => TRANSITION_REGISTRY[id]);
```

- The `<Slideshow>` overlay keeps **two stacked `<img>` layers** (current +
  incoming). On each tick it loads the next image into the hidden layer, waits
  for `onload` (so we never transition to a half-decoded image), then applies the
  registry's enter/exit classes and swaps roles when the CSS transition ends.
- Durations are CSS-driven and honor `design-system.md` motion timing. All
  transitions are pure CSS `transition`/`@keyframes` (opacity, `clip-path`), so
  they run on the compositor and cost no main-thread work.
- Respect `prefers-reduced-motion`: fall back to a short crossfade or `cut`.

### 9.3 Extensibility

Because the registry is the single extension point (like savers), adding e.g.
`ken-burns` (slow pan/zoom, which also doubles as burn-in mitigation, §17 R1) or
`slide` later is one tuple entry + one registry entry + CSS — no structural
change.

---

## 10. Data Model & Schemas

### 10.1 `ui.slideshow` config (shared Zod schema)

Added alongside `screensaverConfigSchema`, hung off `uiConfigSchema`:

```ts
export const SLIDESHOW_TRANSITIONS = ['cut', 'fade', 'crossfade', 'wipe'] as const;
export const SLIDESHOW_ORDERS = ['sequential', 'shuffle'] as const;
export const SLIDESHOW_DEFAULT_INTERVAL_SECONDS = 8;
export const SLIDESHOW_MIN_INTERVAL_SECONDS = 3;
export const SLIDESHOW_MAX_INTERVAL_SECONDS = 3600;

export const slideshowSourceSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  path: z.string(),
  recursive: z.boolean().optional(),
}).strict();

export const slideshowConfigSchema = z.object({
  /** Offer the slideshow as the idle screensaver. */
  useAsScreensaver: z.boolean().optional(),
  intervalSeconds: z.number().int()
    .min(SLIDESHOW_MIN_INTERVAL_SECONDS)
    .max(SLIDESHOW_MAX_INTERVAL_SECONDS).optional(),
  transition: z.enum(SLIDESHOW_TRANSITIONS).optional(),
  order: z.enum(SLIDESHOW_ORDERS).optional(),
  /** Host-mapped folders scanned for images (G5). */
  sources: z.array(slideshowSourceSchema).optional(),
}).strict();
export type SlideshowConfig = z.infer<typeof slideshowConfigSchema>;
```

Wired in: `uiConfigSchema` gains `slideshow: slideshowConfigSchema.optional()`.
Because everything is optional and `.strict()`, an absent block is valid and an
unknown key is a path-scoped validation error (C3).

### 10.2 UI-editable subset (`uiSettingsPatchSchema`)

The Settings modal may persist the non-path fields (`useAsScreensaver`,
`intervalSeconds`, `transition`, `order`). Like `wallpaper.image`,
`slideshow.sources[].path` is intentionally **not** UI-editable (no free-form
filesystem paths from the browser — sources are declared in YAML by the
operator). `UiSettingsPatch` in `ConfigService` and `writeUiSettings` gain a
matching `slideshow` branch that `doc.setIn(['ui','slideshow',…], …)` preserving
comments/secrets.

### 10.3 Manifest (server → web, shared type)

```ts
export interface SlideshowManifestImage { id: string; }        // opaque id only
export interface SlideshowManifest {
  images: SlideshowManifestImage[];                            // resolved order applied server-side or client-side
  settings: {
    intervalSeconds: number;
    transition: SlideshowTransition;
    order: 'sequential' | 'shuffle';
  };
}
```

The manifest carries no filesystem paths — only opaque ids and the resolved
settings. Shuffle can be applied client-side (so it reshuffles each cycle
without a refetch) while `sequential` uses manifest order (folder scan is sorted
deterministically; uploads appended by name).

### 10.4 Upload body

```ts
export const SLIDESHOW_IMAGE_CONTENT_TYPES = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
} as const;
export const slideshowUploadSchema = z.object({
  content_type: z.enum(['image/png','image/jpeg','image/webp','image/gif']),
  data_base64: z.string().min(1),
}).strict();
```

(Direct reuse of the wallpaper upload shape; `gif` added because photo frames
commonly include animated gifs — still raster, still magic-byte validated.)

---

## 11. Server API

All routes registered inline in `packages/server/src/app.ts` (that's where
routes actually live, despite the `routes/` sketch in CLAUDE.md). All gated by
the same auth as other `/api` routes.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/slideshow/manifest` | Resolved image ids + settings. Empty `images: []` when no sources/uploads (never 500). |
| `GET` | `/api/v1/slideshow/image/:id` | Serve one image via `sendIconFile`-style containment. 404 on unknown id. `Cache-Control: public, max-age=…`. |
| `POST` | `/api/v1/slideshow/photos` | Base64 upload → `config/slideshow/uploads/`. Mirrors wallpaper POST (size cap, magic bytes, atomic write, rollback). Returns updated manifest. |
| `DELETE` | `/api/v1/slideshow/photos/:id` | Delete an **uploaded** photo (folder-sourced ids are rejected 400). Returns updated manifest. |

`SlideshowService.resolve()` builds the id→path map on each manifest/serve
request (or from a short-TTL memo invalidated on config hot-reload), so the
serve route re-derives the mapping and never trusts a client-supplied path.
Degradation: with no `libraryService`-style dependency needed, the endpoints work
from config + filesystem alone; a missing/empty uploads dir or an unreadable
source folder logs a warning and yields fewer images, never an error.

---

## 12. Web UI

### 12.1 The overlay — `packages/web/src/slideshow/Slideshow.tsx`

- Props: `{ mode: 'screensaver' | 'ondemand'; onWake?: () => void; onExit?: () => void }`.
- Fetches the manifest via `useSlideshowManifest()` (thin `api.ts` client
  addition, e.g. `fetchSlideshowManifest()`).
- Cycles on `intervalSeconds` with a timer; two stacked `<img>` layers +
  transition registry (§9). Preloads the next image before transitioning.
- **Screensaver mode:** capture-phase wake handler identical to `Screensaver`
  (dismiss + consume first input). Empty manifest → render nothing and signal a
  fallback so `App.tsx` shows the procedural saver instead.
- **On-demand mode:** Back/Home exit (via the keybinding/reserved-key path);
  optional Left/Right = prev/next, OK/Play-Pause = pause/resume. Shows a brief
  focusable affordance so the focus-always-visible rule (C4) holds.
- Empty state on-demand: a centered "No photos yet — add some in Settings"
  message rather than a blank screen.

### 12.2 Launching on demand — home dashboard action (G3)

- Add a **Slideshow** action to the home header (`Header.tsx`) as a new column
  (col 2, after Search/Settings), or as a dedicated tile — final placement to be
  confirmed against `design-system.md`/`screen-inventory.md` (see §18 Q1).
- Handle it in `App.tsx` `onSelect` header branch: `setSlideshow(true)`.
- New state `const [slideshow, setSlideshow] = useState(false)` and an early
  return in `ReadyApp`, ordered among the overlays:
  `if (slideshow) return <Slideshow mode="ondemand" onExit={() => setSlideshow(false)} />;`

### 12.3 Settings additions — `packages/web/src/settings/Settings.tsx`

New rows appended to `ROW_LENGTHS` with cases in `onSelect`, mirroring the
screensaver rows exactly:

- Toggle: **Use slideshow as screensaver** (`useAsScreensaver`).
- Preset picker: **Interval** (e.g. 5s / 8s / 15s / 30s / 60s).
- Picker: **Transition** (`TRANSITION_LIST`).
- Toggle/picker: **Order** (sequential / shuffle).
- **Manage photos:** an upload control (file → base64 → `POST …/photos`) and a
  simple grid to delete uploaded photos. This is the only genuinely new Settings
  interaction pattern; folder sources are shown read-only (they come from YAML).

All persist through `updateUiSettings({ slideshow: {…} })` (except photo
add/delete, which hit the dedicated photo endpoints and then lift the returned
manifest/config).

### 12.4 Config-reference + example

- `config.example/openhearth.yaml`: add a documented `ui.slideshow` stanza next
  to the `ui.screensaver` block, plus an example commented `sources:` entry and
  a `:/photos:ro` note in `docker-compose.yml`'s volumes comments.
- `docs/config-reference.md`: document every `ui.slideshow` field.

---

## 13. Remote-Control Protocol

The screensaver today is **purely client-side** — it is not part of
`stateSnapshotSchema` or `ACTION_NAMES`. The slideshow follows that precedent:
for v1 it is client-state only (`useState` in `App.tsx`), so **no protocol
change and no `PROTOCOL_VERSION` bump** is required.

**Future (optional, additive):** if a physical remote or companion app should
start/stop the slideshow, add `start_slideshow` / `stop_slideshow` to
`ACTION_NAMES` and a reducer case, and possibly a `'slideshow'` value to the
`StateSnapshot.screen` enum. Both are additive per the protocol's "additive
changes don't bump the version" rule, but each is a `.strict()` schema change
that needs a matching reducer + tests + `docs/protocol.md` update. Deferred to a
follow-up; called out here so the door is left open cleanly.

---

## 14. Security & Privacy

- **Raster-only, no SVG** on every image route (SVG is a stored-XSS vector).
  Enforced by the content-type allowlist on upload *and* the extension allowlist
  in the serve helper.
- **Magic-byte validation** (`imageBytesMatch`) on upload — the declared
  content-type must match the actual bytes.
- **Path containment**: the serve route never accepts a client path; it maps an
  opaque id to a path and re-checks two-stage (lexical + symlink-resolved)
  containment within `config/slideshow/uploads/` or a declared source root
  (reusing `sendIconFile` / `isWithinLibraryRoots` logic). Folder scans skip
  symlinks that escape their root.
- **Size cap** on uploads (413 over limit) with base64 headroom on `bodyLimit`,
  as wallpaper does.
- **No phone-home** (C-constraint #4): all images are local; nothing is fetched
  from or sent to any third party. The feature works fully offline.
- **Auth parity**: slideshow routes sit behind the same `server.auth.token`
  gate as other `/api` routes; the single-box kiosk binds to `127.0.0.1`.

---

## 15. Phased Implementation Plan

Dependency-ordered. Each phase is independently reviewable and leaves the app
green. FR/goal refs in parentheses.

### Phase 0 — Plan (this document)

**Goal:** agree the approach before code.
**Exit criterion:** this plan merged / approved on the issue.

### Phase 1 — Config schema + docs foundation

**Tasks (shared):** `slideshowConfigSchema`, `slideshowSourceSchema`,
transition/order/interval constants + types; wire into `uiConfigSchema` and the
editable subset of `uiSettingsPatchSchema`. (C1, C3)
**Tasks (server):** extend `UiSettingsPatch` + `writeUiSettings` in
`ConfigService` for the `slideshow` branch.
**Tasks (docs/config):** `config.example/openhearth.yaml` stanza;
`docs/config-reference.md` section.
**Tests:** shared config validation cases (valid block, bad transition,
out-of-range interval → path-scoped error, unknown key rejected); server
`configExample.test.ts` still passes; `configWriteback.test.ts` covers the new
branch.
**Exit criterion:** config round-trips through validate + write-back; example
YAML validates.

### Phase 2 — `SlideshowService` + read API

**Goal:** the server can enumerate and serve images.
**Tasks (server):** `SlideshowService.resolve()` (scan configured source folders
for image extensions, list `config/slideshow/uploads/`, assign opaque ids,
containment-safe); `GET /api/v1/slideshow/manifest`; `GET
/api/v1/slideshow/image/:id` via a `sendIconFile`-style guard. (G5, C5)
**Tests:** service scan (finds images, ignores non-images, symlink escape
blocked, empty/missing dir → empty list); manifest shape; image serve
(200 for valid id, 404 unknown, 400 path-escape attempt, raster-only).
**Exit criterion:** with a mounted folder of images, `GET …/manifest` lists them
and `GET …/image/:id` returns bytes; cold/empty config yields `images: []`.

### Phase 3 — Upload/delete API + Settings photo management

**Goal:** upload photos through the UI (G4).
**Tasks (server):** `POST /api/v1/slideshow/photos` (mirror wallpaper POST) and
`DELETE /api/v1/slideshow/photos/:id`; `config/slideshow/uploads/` accumulation.
**Tasks (web):** Settings "Manage photos" control (upload + delete grid);
`api.ts` client methods.
**Tests:** upload happy path, oversize → 413, wrong magic bytes → 415, empty →
400, rollback on config-write failure; delete of uploaded id vs rejection of a
folder-sourced id; Settings component test for the upload/delete flow.
**Exit criterion:** a user can add and remove photos from Settings and they
appear in the manifest.

### Phase 4 — `<Slideshow>` overlay + transitions + on-demand launch

**Goal:** the slideshow renders and cycles with selectable transitions (G1, G6),
launchable on demand (G3).
**Tasks (web):** `transitions.ts` registry (cut/fade/crossfade/wipe) + CSS;
`Slideshow.tsx` (two-layer cycling, preload-before-transition, prefers-reduced-
motion); `useSlideshowManifest`; home header Slideshow action + `App.tsx`
on-demand branch; Settings interval/transition/order rows.
**Tests:** overlay advances on interval (fake timers), applies the selected
transition class, preloads next; on-demand Back/Home exits; empty-state message;
transition registry unit test; Settings rows persist via `updateUiSettings`.
**Exit criterion:** launching the slideshow from home cycles the user's photos
with the chosen transition; Back/Home returns home.

### Phase 5 — Screensaver integration + polish

**Goal:** slideshow-as-screensaver (G2) with safe fallback + burn-in mitigation.
**Tasks (shared/web):** add `'slideshow'` to `SCREENSAVERS`; `App.tsx` idle
branch dispatches to `<Slideshow mode="screensaver">` when selected; fallback to
procedural saver when zero images (§17 R4); Settings "use as screensaver" toggle;
optional burn-in mitigation (subtle pan / periodic offset, or ship `ken-burns`
transition).
**Tests:** idle → slideshow when configured; wake consumes first input (mirror
`Screensaver.test.tsx`); empty manifest → falls back to Aurora; suppressed during
playback (existing invariant preserved).
**Tasks (e2e):** on-demand launch + exit; screensaver-slideshow idle path.
**Exit criterion:** with slideshow selected as the screensaver, idle shows the
photo frame and any input dismisses it; no images falls back gracefully.

---

## 16. Testing Strategy

Mirrors the existing test layout (Vitest unit/integration, Playwright E2E).

- **Shared (`config/index.test.ts`):** slideshow config validation — valid
  block, each bad field produces a path-scoped error, unknown key rejected,
  empty `{}` still valid.
- **Server:** `SlideshowService` scan/resolve; each endpoint (manifest, image
  serve with containment, upload with magic-byte/size guards + rollback, delete
  scoping); `configExample.test.ts` and `configWriteback.test.ts` extended.
- **Web:** `Slideshow.test.tsx` (interval advance with fake timers, transition
  class applied, wake consumes event in screensaver mode, Back/Home exit in
  on-demand mode, empty-state); `transitions.test.ts` (registry completeness);
  `Settings.test.tsx` additions (persist + upload/delete flow).
- **E2E (`e2e/`):** a `slideshow.spec.ts` — launch on demand, verify cycling,
  exit via Back; and the screensaver-slideshow idle path. Must not regress the
  must-pass `home-back.spec.ts`.

Every new schema is `.strict()`, so every new field gets a matching validation
test (reject unknown / reject out-of-range) — this is the project's contract.

---

## 17. Risk Register

| id | Risk | Likelihood | Mitigation |
|---|---|---|---|
| **R1** | **Burn-in** from static images on OLED (the screensaver exists to *prevent* this). | High if unaddressed | Ship a subtle motion default in screensaver mode: slow pan/zoom (`ken-burns`) or periodic whole-frame pixel offset; never hold a perfectly static frame indefinitely. Document the recommendation. |
| **R2** | Large images (4K, many MB) blow up memory when several are decoded. | Medium | Only two `<img>` layers live at once; preload exactly one ahead; rely on browser decode + GC. Revisit NG1 (server thumbnails) only if profiling shows a problem. |
| **R3** | A huge source folder (thousands of files) makes scans slow. | Low/Medium | Scans are directory listings (no decode); memoize with short TTL, invalidate on hot-reload; cap manifest size with a logged warning (no silent truncation). |
| **R4** | Slideshow selected as screensaver but **no images** → blank idle screen. | Medium | Screensaver mode falls back to the default procedural saver when the manifest is empty; covered by a test. |
| **R5** | SVG / disguised file upload (stored XSS). | Low | Raster-only content-type allowlist + `imageBytesMatch` magic-byte check + `nosniff` on serve (existing wallpaper defenses). |
| **R6** | Symlink escape from a source folder or uploads dir. | Low | Two-stage (lexical + symlink-resolved) containment on every serve; folder scans skip symlinks leaving their root (`isWithinLibraryRoots` pattern). |
| **R7** | Two render entry points (idle + on-demand) drift out of sync. | Low | One `<Slideshow>` component; `mode` only changes exit behavior; both covered by tests. |
| **R8** | Config hot-reload of `sources` not reflected until restart. | Low | `SlideshowService` reads current config per request (or invalidates its memo on the ConfigService change event), like other services. |

---

## 18. Open Questions

- **Q1 — On-demand entry point placement.** A header action (col 2 next to
  Search/Settings) vs a dedicated home tile vs both? Needs a check against
  `designs/design-system.md` and `screen-inventory.md`, and possibly a design
  pass. Defaulting to a header action for the first cut.
- **Q2 — Animated GIF support.** Included in the allowlist (still raster,
  magic-byte-checked). Confirm this is wanted; drop `gif` if not.
- **Q3 — Burn-in default.** Should screensaver mode *force* a motion transition
  (ken-burns) regardless of the user's chosen transition, to guarantee no static
  hold? Leaning yes for screensaver mode, honor the user's choice on-demand.
- **Q4 — Recursive folder scan default.** Off by default with an opt-in
  `recursive` flag, or on by default? Proposing off-by-default (predictable, and
  avoids accidentally slurping a whole `/media` tree).
- **Q5 — Protocol control now or later?** Plan defers `start_slideshow` /
  `stop_slideshow` to a follow-up (§13). Confirm that's acceptable for v1 of the
  feature.

---

## 19. Definition of Done

- [ ] `ui.slideshow` config validates through the shared schema; absent/empty
      config stays valid; invalid edits fall back to last-good (C3).
- [ ] Photos can be **uploaded and deleted** through Settings and appear in the
      slideshow (G4).
- [ ] A **local folder** mounted into the container and declared in
      `ui.slideshow.sources` is scanned and its images appear (G5).
- [ ] The slideshow can be launched **on demand** from the home screen and exits
      on Back/Home (G3).
- [ ] The slideshow can be selected as the **screensaver** and activates on idle,
      dismissing on any input; empty manifest falls back to a procedural saver
      (G2, R4).
- [ ] **Fade, crossfade, and wipe** transitions are selectable and applied
      between images; `cut` is the honest no-animation option (G6).
- [ ] All image routes are raster-only, magic-byte-validated, path-contained,
      and size-capped (§14).
- [ ] No `PROTOCOL_VERSION` bump; screensaver-suppression-during-playback and the
      must-pass Home/Back E2E are unregressed.
- [ ] `config.example/openhearth.yaml` + `docs/config-reference.md` document
      every new field; `docker-compose.yml` shows an example `:/photos:ro` mount.
- [ ] Unit, integration, and E2E tests green; `pnpm lint`, `pnpm typecheck`,
      `pnpm test` pass.
