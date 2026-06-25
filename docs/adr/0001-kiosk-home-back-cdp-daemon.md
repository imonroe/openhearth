# ADR 0001 — Kiosk Home/Back via an OS key-daemon driving Chrome over CDP

- **Status:** Proposed
- **Date:** 2026-06-25
- **Deciders:** @imonroe
- **Supersedes (partially):** the `--load-extension` half of the home-guard
  mechanism (PR #134 / #133). The in-app interception in
  `packages/web/src/reserved.ts` + `FocusProvider` is unchanged.

## Context

OpenHearth's single highest-risk behavioral guarantee is FR-A3 / NFR-5: from
inside a launched commercial service (Netflix, Sling, YouTube TV, …), the **Home**
key always returns to the OpenHearth home screen. Today that guarantee, once the
kiosk has navigated away from the SPA, rests entirely on the `home-guard`
Chromium extension loaded via `--load-extension`.

Field testing (this PR's parent discussion) surfaced a hard contradiction. The
two capabilities the kiosk needs live in **different browsers**:

| Browser | Plays Widevine (Netflix/Sling/YT TV) | Loads `home-guard` via `--load-extension` |
| --- | --- | --- |
| Branded Google Chrome / Edge 137+ | ✅ ships the Widevine CDM | ❌ flag removed (mid-2025 security hardening) |
| Chrome for Testing | ❌ no Widevine CDM | ✅ honors the flag |
| Chromium built from source | ❌ no Widevine unless added by hand | ✅ honors the flag |

PR #134 made the extension load reliably by recommending Chrome for Testing —
which is exactly the browser with **no Widevine**, so DRM-protected services
won't play. We traded streaming for the Home key. The architecture isn't wrong;
the flaw is binding the Home/Back guarantee to a CLI-loaded **extension that must
live in the same browser that plays the stream**.

A secondary, related defect: launched services like YouTube `/tv` fall back to
the desktop site because a plain browser can only set one global
`--user-agent`, and it cannot be set **per service** for a top-level
navigation.

## Decision

**Decouple the Home/Back guarantee from the browser.** Use a Widevine-capable
**branded Chrome** for rendering, and move the reserved-key interception to an
**OS-level key-daemon** that drives the browser over the **Chrome DevTools
Protocol (CDP)**.

Concretely:

1. Launch branded Chrome in `--app` kiosk mode with a CDP endpoint
   (`--remote-debugging-port=<port>` bound to `127.0.0.1`, dedicated
   `--user-data-dir`). Branded Chrome ships Widevine, so DRM services play.
2. A small native daemon grabs the reserved keys **globally**, before the focused
   page sees them:
   - **Linux:** read `/dev/input` via `evdev` (the daemon owns a grab on the
     Home/Back keys).
   - **Windows:** a low-level keyboard hook (e.g. AutoHotkey or a tiny Win32
     helper).
3. On a reserved key, the daemon issues a CDP command to the active target:
   - **Home / Back** → `Page.navigate` to the configured OpenHearth `homeUrl`.
   - The daemon reuses the same `returnKeys` / `homeUrl` config vocabulary the
     `home-guard` already defines, so deployment config stays familiar.
4. **Per-service user-agent** is solved in the same layer: the daemon (or the
   launch handoff) applies `Network.setUserAgentOverride` per navigation, so the
   YouTube `/tv` tile can request a TV-class UA without affecting other tiles.

The existing in-app handler (`reserved.ts` + `FocusProvider`) continues to own
Home/Back **while OpenHearth is the active page**. The `home-guard` content
script is **retained as a defense-in-depth in-frame layer** (it still fires for
keys that reach the page), but it is no longer the sole or primary mechanism, so
it no longer dictates the browser choice.

## Why not the alternatives

- **A — Force-install the extension via managed enterprise policy** (branded
  Chrome + `ExtensionInstallForcelist`/`ExtensionSettings` + a packed `.crx`).
  Smallest change and keeps the extension, but adds per-OS policy + `.crx`
  hosting friction and **does not** solve per-service UA. Kept as a documented
  stopgap for users who want to stream immediately without the daemon.
- **C — Embed our own Widevine-enabled Chromium (castlabs Electron / ECS).**
  Most robust (DRM, Home/Back, and per-service UA all in-process, no external
  browser lottery), but it makes the kiosk a first-class, per-platform,
  signed desktop deliverable. Right eventual destination if OpenHearth becomes a
  true appliance; too heavy for this iteration. Revisit as a future ADR.

## Consequences

**Positive**
- DRM works: rendering happens in branded Chrome with Widevine.
- Brand-agnostic Home/Back: the guarantee no longer depends on any
  browser-specific extension-loading behavior that a vendor can remove.
- Per-service UA becomes possible (fixes the YouTube `/tv` → desktop fallback).
- The Docker-serves-UI / browser-is-renderer model is unchanged; this is purely
  a host-side launch concern.

**Negative / risks**
- **New moving part:** a native daemon + CDP client to build, package, and
  maintain per-OS.
- **CDP is a local attack surface.** Mitigations: bind `--remote-debugging-port`
  to `127.0.0.1` only, dedicated profile, no LAN exposure; document the
  trade-off. (Chrome's `--user-data-dir` requirement for remote debugging is
  satisfied by the existing dedicated kiosk profile.)
- **Timing/robustness:** the daemon must reliably grab keys before the page and
  reconnect to CDP if Chrome restarts (watchdog/reconnect loop required).
- **YouTube `/tv` caveat:** a TV-class UA may improve but is **not guaranteed**
  to fully restore the leanback surface — Google is deprecating that HTML
  surface for non-certified devices. This ADR makes per-service UA *possible*;
  it does not promise leanback parity.

## Open questions (to resolve in implementation)

1. **Daemon language/runtime.** A single small Go or Node binary that does both
   evdev grab and CDP, vs. a thin shell around AutoHotkey on Windows. Leaning
   toward one Node CLI in `scripts/kiosk/` reusing the repo toolchain, with a
   platform key-capture shim.
2. **CDP target discovery.** `--app` mode has one tab; confirm we can address it
   stably across in-service navigations and Chrome restarts.
3. **Config surface.** Reuse `home-guard/config.js` values, or introduce a
   single kiosk config (`homeUrl`, `returnKeys`, `debug`, per-service UA map)
   that both the daemon and the (retained) content script read.
4. **E2E coverage.** The must-pass launch→Home→home test currently asserts the
   content script consumed `config.js`. Extend it to cover the daemon path (CDP
   `Page.navigate` on a simulated reserved key) under xvfb.

## Implementation sketch (non-binding)

```
scripts/kiosk/
  openhearth-kiosk.sh        # launch branded Chrome --app + --remote-debugging-port=127.0.0.1:<port>
  home-daemon/               # NEW: key grab (evdev / win hook) → CDP Page.navigate(homeUrl)
    index.(ts|go)
    config.js                # homeUrl, returnKeys, debug, perServiceUserAgent map
  home-guard/                # RETAINED as in-frame defense-in-depth
```
