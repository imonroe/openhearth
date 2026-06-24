# OpenHearth Remote-Control Protocol — v1

This document is the **authoritative, frozen specification** of the OpenHearth
remote-control protocol (the "seam"). A third-party client — for example a phone
remote (`openhearth-remote`) — can be implemented entirely against this document.

The protocol is the *only* contract between the **Brain** (`packages/server`, the
Node/Fastify backend) and any **Face** (the kiosk web UI, a phone remote, a CLI).
Both sides validate every message against the schemas in
[`packages/shared/src/protocol`](../packages/shared/src/protocol/index.ts), which
are the single source of truth; this document mirrors them.

- **Protocol version:** `1`
- **Status:** frozen. The v1 action vocabulary, envelopes, and event shapes below
  do not change within v1. Additive, backward-compatible extensions (new optional
  fields, new event types, new actions) ship without a version bump; any breaking
  change increments `protocol_version` (see [Versioning](#versioning)).

---

## 1. Transport

Two interchangeable transports carry the same command vocabulary:

| Transport | Endpoint | Direction | Use |
|---|---|---|---|
| **WebSocket** | `GET /api/v1/control/ws` | bidirectional | Live clients: send commands, receive `state_changed` broadcasts. |
| **REST mirror** | `POST /api/v1/control/command` | request/response | Simple/stateless clients: apply one command, get the new state back. |

All bodies are JSON (`Content-Type: application/json`). The REST API is served from
the same origin as the web UI (default `http://<host>:8080`). API responses set
`Cache-Control: no-store` except where noted (artwork).

A client that only needs to *read* state can poll `GET /api/v1/state`, but the
WebSocket is preferred — it pushes the authoritative snapshot on connect and on
every change, so a client never polls.

---

## 2. Versioning

`protocol_version` is a single integer, currently **`1`**.

- Every command **must** carry `"protocol_version": 1`. A command with a different
  version fails validation (HTTP `400` / WS error frame).
- Every event the server emits carries `"protocol_version": 1`.
- **Bump policy:** the version is incremented **only on a breaking change** to the
  envelope or action vocabulary (removing/renaming an action, changing a field's
  type or required-ness, changing event semantics). Backward-compatible additions
  — a new optional `params` key, a new action name, a new event type — do **not**
  bump the version; older clients ignore what they don't understand.
- Clients should treat a `protocol_version` higher than they support as "newer
  server, proceed but expect unknown fields," and a lower one as "older server."

---

## 3. Authentication (reserved)

v1 ships with **no authentication by default** — OpenHearth assumes a trusted home
LAN (PRD §17). The protocol *reserves* the mechanism so it can be enabled without a
version bump:

- The command envelope has an optional **`auth`** string field (a shared token).
  In v1 it is **accepted and ignored**.
- Optional shared-token enforcement (reject unauthenticated commands when a token
  is configured) and a configurable bind address land in **issue #47**. When
  enabled, a client sends its token in `auth` on every command; the WS handshake
  may additionally accept it.
- Operators exposing the server beyond a trusted LAN should bind to loopback or a
  private interface and/or enable the token — see the security notes in the
  deployment docs.

---

## 4. Message envelopes

Every message crossing the seam is a JSON object discriminated by `type`.

### 4.1 Command (client → server)

```jsonc
{
  "type": "command",
  "protocol_version": 1,
  "action": "play_pause",        // one of the action vocabulary (§5)
  "params": { "level": 40 },     // optional, per-action (§5)
  "id": "c-42",                  // optional client correlation id
  "auth": "<shared-token>"       // optional, reserved (§3)
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | `"command"` | yes | Discriminator. |
| `protocol_version` | `1` | yes | Must equal the server's version. |
| `action` | enum (§5) | yes | The action to perform. |
| `params` | object | no | Action-specific parameters; open bag. |
| `id` | string | no | Echoed/usable by the client to correlate a result. |
| `auth` | string | no | Reserved shared token (§3); ignored in v1. |

### 4.2 Event (server → client, broadcast)

```jsonc
{
  "type": "event",
  "protocol_version": 1,
  "event": "state_changed",
  "state": { /* StateSnapshot, §6 */ }
}
```

| Field | Type | Notes |
|---|---|---|
| `type` | `"event"` | Discriminator. |
| `protocol_version` | `1` | |
| `event` | enum | `"state_changed"` in v1; new event types extend the enum. |
| `state` | object | The full authoritative [state snapshot](#6-state-snapshot). |

> The published JSON Schema types `state` loosely (an optional, open object) for
> forward-compatibility with future event types that may carry a different
> payload. For a `state_changed` event the server **always** sends a complete
> [state snapshot](#6-state-snapshot), so clients can rely on that shape.

### 4.3 Error frame (WebSocket only)

When a WS client sends a malformed frame, the server replies on the same socket
(it does **not** close the connection):

```jsonc
{ "type": "error", "error": "invalid JSON" }
{ "type": "error", "error": "invalid command", "details": ["protocol_version: ..."] }
```

Error frames are not part of the validated command/event union — they are
diagnostic. A client should surface them but need not parse `details` rigidly.

---

## 5. Action vocabulary

The complete, frozen v1 vocabulary. The keyboard handler (and any remote) maps
inputs to **exactly these actions** — no action is keyboard-specific. The server
applies a command with a pure reducer
([`applyCommand`](../packages/shared/src/protocol/index.ts)) and broadcasts the
resulting snapshot.

| Action | Params | Effect on server state | Notes |
|---|---|---|---|
| `navigate` | `{ direction }` | none (focus is client-side) | Broadcast for parity, but the server snapshot is unchanged — focus depends on the rendered grid and lives in the client. |
| `select` | — | none (client-side) | Activates the focused element on the client. |
| `back` | — | `player → service` (if a service is active) else `→ home` | One level up. |
| `home` | — | `screen → home` | **Reserved & always available** (see §7). |
| `play_pause` | — | toggles `playback.status` between `playing`/`paused` | No-op when nothing is loaded. |
| `seek` | `{ position_s }` | sets `playback.position_s` | Ignored if `position_s` is missing/negative/non-finite. |
| `stop` | — | `playback → { stopped, item_id: null, position_s: 0 }` | |
| `launch_service` | `{ service_id }` | `screen → service`, `service_id` set | Strategy A launcher. |
| `play_item` | `{ item_id }` | `screen → player`, `playback → { playing, item_id, 0 }` | Strategy C player. |
| `set_volume` | `{ level }` (0–100) | sets `volume` (clamped 0–100) | Ignored if `level` missing/non-finite. |

`navigate` and `select` return the same state reference; the server treats that as
a no-op and **does not broadcast** (a remote still gets confirmation via the REST
response, and live clients act on their local focus engine).

---

## 6. State snapshot

The authoritative state the server holds and broadcasts. Focus is intentionally
**not** in the snapshot — it is a client-side concern (it depends on the rendered
grid). Wire keys are `snake_case`.

```jsonc
{
  "screen": "home",                 // "home" | "service" | "player"
  "playback": {
    "status": "stopped",            // "stopped" | "playing" | "paused"
    "item_id": null,                // library item id, or null
    "position_s": 0                 // integer seconds, ≥ 0
  },
  "service_id": null,               // most-recently launched service id, or null
  "volume": 50                      // integer 0–100
}
```

The initial state on a cold server is exactly the object above (`volume: 50`).

---

## 7. The Home/Back guarantee (must-pass)

`home` is a **reserved** action: it always returns to the OpenHearth home screen,
and the kiosk intercepts the Home/Back keys *before* they can reach a launched
commercial service (FR-A3 / NFR-5). This interception is enforced at the browser
level (a kiosk extension + capture-phase handlers), not in application code, and is
covered by dedicated must-pass E2E tests. See
[`docs/home-back.md`](home-back.md) for the full guarantee and its test strategy.

Protocol-side, the guarantee means: a client may send `{ "action": "home" }` at any
time and the server will set `screen: "home"`; the action can never be remapped
into uselessness or shadowed.

---

## 8. REST surface

All endpoints are under `/api/v1`. Unless noted, success is `200` with a JSON body,
and errors are a JSON object `{ "status": "<code>", "errors"?: string[] }`.

### Control & state

| Method · Path | Request | Success | Errors |
|---|---|---|---|
| `GET /state` | — | the [state snapshot](#6-state-snapshot) | — |
| `POST /control/command` | a [command](#41-command-client--server) | `{ "status": "ok", "state": <snapshot> }` | `400 { status: "invalid", errors }` |
| `GET /control/ws` | WebSocket upgrade | stream of [events](#42-event-server--client-broadcast) | error frames (§4.3) |

### System

| Method · Path | Success body |
|---|---|
| `GET /health` | `{ status: "ok", protocol_version: 1, uptime_s, config_valid }` |
| `GET /config` | `{ config, errors, valid }` — secrets (e.g. `metadata.tmdbApiKey`) are **redacted** (`***`); this endpoint is unauthenticated. |

### Services (Strategy A)

| Method · Path | Notes |
|---|---|
| `GET /services` | Ordered, grouped service-tile catalog. |
| `GET /services/:id/icon` | Local (config-dir) icon file. `404` if absent/remote; `400` on a containment violation. Remote (`http(s)`) icons are loaded directly by the client. |

### Library & player (Strategy C)

| Method · Path | Notes |
|---|---|
| `GET /library?source=&kind=&limit=&offset=` | Paginated items: `{ items, total, limit, offset }`. `kind` ∈ `movie\|episode\|other`; invalid `kind` → `400`. Repeated params take the last value. `limit` clamps to 1–500 (default 100). Each item may carry `artwork_url` (§ metadata). |
| `GET /library/:id` | A single item; `404` if unknown. |
| `GET /library/:id/artwork` | The cached poster image; `404` if none cached, `502` if the download fails. Sets `Cache-Control: public, max-age=86400`. |
| `GET /library/:id/stream` | Direct-play with HTTP **Range** (`206`/`416`) when the browser can play the file, else a transcoded fragmented-MP4 stream (`200`, `video/mp4`). `?t=<sec>` restarts a transcode at an offset (seeking). `404` unknown/missing, `403` outside the library roots, `502` probe failure, `503` no transcoder. |
| `GET /library/:id/resume` | Saved resume position `{ position_sec, updated_at }`, or `null`. |
| `PUT /library/:id/resume` | Body `{ position_sec }` (≥ 0). A position `< 1s` clears (treat as start). `400` malformed, `404` unknown item. |
| `DELETE /library/:id/resume` | Forget the saved position. |
| `GET /library/:id/subtitles` | List of `{ id, label, lang?, source }` tracks (sidecar + embedded). |
| `GET /library/:id/subtitles/:track` | The track as WebVTT. `403` outside the library roots, `404` unknown. |

### Search (Strategy B foundation)

| Method · Path | Notes |
|---|---|
| `GET /search?q=&limit=` | `{ query, sections, total }`. v1 returns a single `library` section of normalized media items; future cross-service sources slot in as additional `source`-keyed sections without a breaking change. `limit` clamps to 1–100 (default 50). Empty/non-matching query → `sections: []`. |

---

## 9. Error model

- **REST:** non-2xx responses carry a JSON body `{ "status": "<machine code>" }`,
  optionally with `"errors": string[]` for validation failures. Status codes used:
  `400` (bad request / invalid command), `403` (forbidden — path containment),
  `404` (not found), `416` (range not satisfiable), `502` (upstream/probe failure),
  `503` (a capability isn't wired, e.g. no transcoder). Machine codes seen in v1
  include `invalid`, `bad_request`, `not_found`, `forbidden`, `probe_failed`,
  `artwork_unavailable`, `unavailable`.
- **WebSocket:** malformed frames get an [error frame](#43-error-frame-websocket-only)
  on the same socket; the connection stays open.
- **Graceful degradation:** a misconfigured or absent capability never crashes a
  request. With no metadata provider, library items simply omit `artwork_url`; with
  no transcoder, `stream` returns `503`; a config error surfaces in `GET /config`'s
  `errors[]` rather than failing the server.

---

## 10. Examples

### REST mirror — set the volume

```
POST /api/v1/control/command
Content-Type: application/json

{ "type": "command", "protocol_version": 1, "action": "set_volume", "params": { "level": 40 } }
```

```jsonc
// 200 OK
{
  "status": "ok",
  "state": {
    "screen": "home",
    "playback": { "status": "stopped", "item_id": null, "position_s": 0 },
    "service_id": null,
    "volume": 40
  }
}
```

### WebSocket session

```
→ (connect) GET /api/v1/control/ws

← { "type": "event", "protocol_version": 1, "event": "state_changed",
    "state": { "screen": "home", "playback": { "status": "stopped", "item_id": null, "position_s": 0 }, "service_id": null, "volume": 50 } }

→ { "type": "command", "protocol_version": 1, "action": "play_item", "params": { "item_id": "abc123" } }

← { "type": "event", "protocol_version": 1, "event": "state_changed",
    "state": { "screen": "player", "playback": { "status": "playing", "item_id": "abc123", "position_s": 0 }, "service_id": null, "volume": 50 } }

→ { "type": "command", "protocol_version": 1, "action": "home" }

← { "type": "event", "protocol_version": 1, "event": "state_changed",
    "state": { "screen": "home", "playback": { "status": "playing", "item_id": "abc123", "position_s": 0 }, "service_id": null, "volume": 50 } }
```

### Invalid command (REST)

```jsonc
// 400 Bad Request
{ "status": "invalid", "errors": ["protocol_version: Invalid literal value, expected 1"] }
```

---

## 11. Conformance

The JSON Schemas backing this document are generated from the Zod schemas and
exported as `protocolMessageJsonSchema` (and per-shape schemas) from
`@openhearth/shared`. The examples in §10 are validated against those schemas in
the test suite, so this document cannot drift from the implementation without a
failing test. A third-party client should validate inbound events and its own
outbound commands against the published schema.
