# Competitive landscape — prior art & alternatives

A survey of open-source projects that overlap with OpenHearth, so we can position
against them and answer the inevitable *"why not just use X?"* from self-hosters.

**Headline:** nothing in the open-source world does exactly what OpenHearth does —
a **Docker-native, web-based launcher** that tiles commercial streaming services
**and** embeds a **native transcoding player** **and** enforces **Home/Back kiosk
interception** ([FR-A3](prd.md), [ADR 0001](adr/0001-kiosk-home-back-cdp-daemon.md)).
Several projects overlap on individual axes, but none occupy the intersection.

> This is a point-in-time snapshot (2026-07). Treat project capabilities as
> subject to change; re-verify before citing in public-facing material.

## Tier 1 — Direct HTPC launchers (closest in intent)

### PC-Launcher
<https://github.com/PC-Launcher/PC-Launcher>

The single closest match on *purpose*: a controller-friendly HTPC hub that tiles
Netflix, Disney+, Hulu, YouTube, and YouTube TV, launches them **in a browser**
(Edge/Chrome), and shells out to local players like Plex HTPC.

Key differences from OpenHearth:
- Windows-only, C#/WPF desktop app — **not Docker-native, not web-based**.
- Launches the browser as a *separate process*, so there is **no Home/Back
  interception** — our single highest-risk, must-pass behavior.
- No native player/transcoding; it delegates local media to Plex HTPC.

### Flex Launcher
<https://complexlogic.github.io/flex-launcher/> · <https://github.com/complexlogic/flex-launcher>

The most popular and polished OSS HTPC launcher. Explicitly a "TV-friendly
10-foot UI" meant to mimic a streaming box; fully navigable by remote/gamepad;
Windows + Linux + Raspberry Pi; SDL2-based. But it is a **generic application
launcher** — tiles map to arbitrary commands/executables. No streaming-service
definitions, no embedded player, no metadata layer, no kiosk key interception.
The "dumb but reliable" version of our Strategy A. Fork of note:
[better-launcher](https://github.com/dmahacker/better-launcher) (adds macOS).

## Tier 2 — Android TV launchers (same UX niche, different platform)

- **[FLauncher](https://alternativeto.net/software/flauncher--android-tv/about/)** —
  Open-source Flutter launcher for Android TV / Fire TV; no ads, custom
  categories, wallpapers. Closest philosophical cousin (ad-free replacement
  launcher) but tied to the Android TV app model, not a self-hosted container.
- **LeanbackLauncher / leanback-on-fire** — de-Amazon-ing the Fire TV home screen.

These compete for the same user ("ad-free launcher instead of Roku/Fire OS") but
assume Android TV hardware.

## Tier 3 — Linux TV shells

- **[Plasma Bigscreen](https://alternativeto.net/software/plasma-bigscreen/)** —
  KDE's full 10-foot desktop shell for TVs. Broader scope (a whole OS UI),
  heavier, not a self-hosted service.
- **Kodi / LibreELEC / OSMC** — The incumbent HTPC platform. Kodi is a *media
  center* first; it can launch external apps via add-ons/skins, but commercial
  streaming services are second-class (DRM-gated add-ons), and it is not a
  container you point a browser at. This is the tool the PRD is implicitly
  reacting against.

## Tier 4 — Self-hosted dashboards (overlap on "tiles + Docker," not TV/streaming)

- **Homarr**, **Heimdall**, **Organizr**, **Dashy** — Docker-native, web-based
  tile dashboards. Architecturally the *most similar to our stack* (container,
  web UI, YAML/DB config, app tiles), but they are **desktop/mouse dashboards for
  launching web apps**: no 10-foot focus engine, no remote-control protocol, no
  Home/Back interception, no media player. A user *could* bolt one onto a kiosk
  browser and approximate a launcher — this is the real "roll-your-own"
  competition.

## Adjacent — the media servers themselves

**Jellyfin** (+ the [Media Bar plugin](https://github.com/IAmParadox27/jellyfin-plugin-media-bar)),
**Plex**, **Emby** own **Strategy C** (local library + transcoding) far more
maturely than v1 OpenHearth. Jellyfin is Docker-native, transcodes with ffmpeg,
and has TV clients. What they *don't* do is launch external commercial services —
Jellyfin's home screen only surfaces your own library, and an
[external-launcher feature request](https://features.jellyfin.org/posts/3478/add-media-bar-to-standard-home-screen)
remains unbuilt. OpenHearth's launcher + player combination is precisely this gap.

## Capability matrix

| Capability | OpenHearth | PC-Launcher | Flex Launcher | FLauncher | Homarr/Heimdall | Jellyfin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Docker-native / self-hosted service | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Web UI (browser is renderer) | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Tiles commercial streaming services | ✅ | ✅ | ⚠️ generic | ✅ | ⚠️ generic | ❌ |
| **Home/Back kiosk interception** | ✅ | ❌ | ❌ | n/a (OS) | ❌ | ❌ |
| Native local player + ffmpeg transcode | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Remote-control protocol (WS/REST) | ✅ | ❌ | ❌ | ❌ | ❌ | ⚠️ own |
| 10-foot focus engine | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ (clients) |

Legend: ✅ yes · ❌ no · ⚠️ partial/generic.

## Where OpenHearth is differentiated

The defensible niche is the intersection nobody else occupies: a **containerized,
web-native** box that unifies commercial-service launching **and** local playback
under one TV-grade focus UI, with the **kiosk-level Home/Back guarantee** as the
technical moat.

- Closest by *intent*: **PC-Launcher** — but Windows desktop, no interception, no player.
- Closest by *architecture*: the **Homarr/dashboard family** — but no TV UX, no player, no key guarantee.
- Closest by *media capability*: **Jellyfin** — but no commercial-service launcher.

### Positioning implications

- The kiosk Home/Back CDP daemon ([ADR 0001](adr/0001-kiosk-home-back-cdp-daemon.md))
  is the hard part everyone else skipped — lead with it in any comparison.
- The most likely "why not just use X?" objections are *"I already run Homarr in a
  kiosk tab"* and *"Jellyfin already does my local media."* Framing OpenHearth as
  the thing that **unifies both worlds, ad-free** is stronger than competing on
  either half alone.

## Sources

- PC-Launcher — <https://github.com/PC-Launcher/PC-Launcher>
- Flex Launcher — <https://complexlogic.github.io/flex-launcher/> · <https://github.com/complexlogic/flex-launcher> · <https://alternativeto.net/software/flex-launcher>
- better-launcher — <https://github.com/dmahacker/better-launcher>
- FLauncher (Android TV) — <https://alternativeto.net/software/flauncher--android-tv/about/>
- Plasma Bigscreen — <https://alternativeto.net/software/plasma-bigscreen/>
- Homarr overview — <https://www.blog.brightcoding.dev/2025/07/30/homarr-the-modern-dashboard-for-taming-your-self-hosted-universe/>
- Jellyfin — <https://jellyfin.org/> · Media Bar plugin — <https://github.com/IAmParadox27/jellyfin-plugin-media-bar> · external-launcher feature request — <https://features.jellyfin.org/posts/3478/add-media-bar-to-standard-home-screen>
- htpc GitHub topic — <https://github.com/topics/htpc>
