# OpenHearth — Screen Inventory

> A designer handoff document listing every screen and major UI state needed for the OpenHearth v1.0 10-foot TV interface. This covers the React SPA (the "face") rendered in the Chromium kiosk. It does not cover any server-side or configuration tooling.
>
> **PRD ref:** [`docs/prd.md`](../docs/prd.md) · **Impl ref:** [`docs/implementation_plan.md`](../docs/implementation_plan.md)

---

## Design Direction

**Modern, sleek, and comfortable.** OpenHearth lives in a dark living room on a 55"+ screen, watched from 10 feet away. The aesthetic should feel like a premium cinema experience — rich dark backgrounds with deep contrast, warm accent tones (the brand name evokes a hearth — think amber, ember, warm off-white), large confident typography, and artwork-first layouts where posters and stills are the heroes. Nothing should feel corporate or sterile. The UI should disappear when content is playing and feel inviting the moment it returns.

**Core design constraints:**
- Minimum interactive target size: visually significant at 10 feet
- TV-safe area: all content within ~5% overscan margins
- High-contrast focus indicator: the focused element must be unambiguously clear at viewing distance
- All navigation is directional (up/down/left/right + select/back/home) — no cursor or pointer
- Typography: generous sizing, high contrast, no thin weights

---

## Navigation Map

```
Startup Screen
    │
    └── Home Screen ───────────────────────────────────────────────────────────────────────┐
         ├── [Service tile selected] → Service Launch Transition → Commercial Service Active│
         │                              (any key Home/Back) → Return-to-Home Overlay ──────┘
         │
         ├── [Movie row tile selected] → Movie Detail
         │                                   └── [Play] → Player
         │
         ├── [TV row tile selected] → TV Show Detail
         │                               ├── [Season/Episode selected] → Episode Detail
         │                               │                                   └── [Play] → Player
         │                               └── (back) → Home Screen
         │
         ├── [Search action] → Search Screen
         │                         └── [Result selected] → Movie Detail or TV Show Detail
         │
         └── Player ──────────────────────────────────────────────────────────────────────┐
                  └── [Stop / Back] → Home Screen or Item Detail                          │
                                                                                          │
         Config Error Banner (overlay, non-modal, any screen)                             │
         Resume Prompt (overlay on Item Detail or Player entry)                           │
```

---

## Screen 1 — Startup / Loading Screen

**Role:** First frame shown when the kiosk browser loads, before the server has responded and the UI is ready.

**Primary content:**
- OpenHearth logotype and/or wordmark, centered
- Subtle loading indicator (spinner, pulse, or animated logo element)
- No interactive elements

**States to design:**
- `loading` — initial state; logo + indicator
- `error` — if the server doesn't respond within a timeout; message prompting the user to check their setup

**Design considerations:**
- Should feel like a premium app launch, not a generic spinner
- Warm, dark background — the first impression of the brand
- No text beyond the brand name; the indicator communicates progress silently

**PRD refs:** NFR-1 (home interactive within ~2s), FR-S1

---

## Screen 2 — Home Screen

**Role:** The primary living-room hub. The screen the user returns to after watching anything. All navigation starts here.

**Primary content:**
- **Header bar (top):** OpenHearth logo/wordmark left-aligned; optional clock or ambient status right-aligned
- **Content rows (vertically stacked, horizontally scrollable):**
  - Row type A — **Streaming Services:** a horizontal strip of service tiles (square or 16:9 aspect), each showing the service's logo/icon and name label. Order and grouping defined in `services.yaml`.
  - Row type B — **Library rows:** "Movies," "TV Shows," etc. Horizontal strip of media tiles (portrait/poster aspect ratio), showing artwork, title, and year. Populated from the library index.
- **Row headers:** label for each row (e.g. "Streaming Services," "Movies"), left-aligned, above the tile strip
- **Focus state:** one tile is focused at all times; it should be unmistakably highlighted (scale + glow or border treatment)

**States to design:**
- `loading` — tiles are skeletons/placeholders while data hydrates; row headers are present
- `default` — fully loaded, first tile in first row focused
- `focused-service-row` — a service tile is highlighted; the row feels "active"
- `focused-library-row` — a library tile is highlighted
- `no-content` — a specific row is empty (e.g. no library configured): show a graceful empty-row placeholder with a brief helper note
- `partial-metadata` — library tiles without poster art (no provider configured); show a tasteful text-only or placeholder tile rather than broken imagery

**Navigation context:**
- Arrow right/left: move focus within a row
- Arrow down/up: jump between rows (focus lands on the nearest tile in the new row)
- Select: enter the focused tile (launch service or open media)
- Search action (configurable key): navigate to Search Screen

**Design considerations:**
- The service row and library rows can use slightly different tile shapes — services tend to be more logo/brand driven (landscape or square), library content is artwork/poster driven (portrait)
- Horizontal scrolling within a row should feel smooth and native; off-screen tiles can peek slightly at the edge to signal scrollability
- The "active row" visual treatment should subtly differentiate which row is currently focused without distracting from the content
- Row label typography should be subdued relative to tile art
- Background: very dark, near-black — lets tile artwork pop
- Consider a subtle full-bleed background art effect when a tile is focused (blurred, darkened poster or backdrop), similar to Apple TV's home screen ambient blur

**PRD refs:** FR-A1, FR-C2, FR-CFG1, §14.3, NFR-1, NFR-2

---

## Screen 3 — Config Error Banner

**Role:** Non-fatal, non-blocking notification that the config file has validation errors. Overlaid on whatever screen is currently visible. The UI remains navigable; the banner just reports the problem.

**Primary content:**
- Thin banner anchored to the top or bottom edge of the screen
- Icon (warning/caution)
- Short error summary: e.g. "Config error in services.yaml — using last valid settings"
- Optionally: more detail accessible on a secondary "press X to see details" affordance

**States to design:**
- `warning` — yellow/amber treatment; recoverable error (last-good config active)
- `dismissible` — option to dismiss until the next config reload

**Design considerations:**
- Must not obscure row content or the focus tile; position at the very top or very bottom
- Warm amber tone fits the brand and communicates "attention needed" without alarm
- Should auto-dismiss after some time or when config becomes valid again
- Keep it brief; homelabbers will know what to do

**PRD refs:** NFR-4, FR-CFG2, issue #22

---

## Screen 4 — Service Launch Transition

**Role:** The brief animated moment between selecting a service tile on the Home Screen and the commercial service's web player taking over the kiosk. A transitional screen, not a static one.

**Primary content:**
- Animated transition: the selected service tile "expands" to fill the screen (zoom or fade)
- Service name and/or logo during the transition
- Brief loading indicator while the service URL navigates
- A visual note: "Press Home to return to OpenHearth" (or the configured Home key hint) — appears briefly and then fades

**States to design:**
- `launching` — tile expanding, loading indicator active
- `loaded` — transition complete; the service UI has taken over (OpenHearth chrome is gone)

**Design considerations:**
- This transition should feel smooth and intentional, not jarring
- The "press Home to return" hint should appear prominently during launch and fade naturally — it's important for the first-time-user experience
- Once the service is loaded, OpenHearth's UI is invisible; what the user sees is the service's own interface

**PRD refs:** FR-A2, FR-A3, §11.5

---

## Screen 5 — Return-to-Home Overlay

**Role:** The moment of returning from a commercial service back to OpenHearth (triggered by the reserved Home/Back binding). A brief overlay that confirms the return before the Home Screen fully reappears.

**Primary content:**
- Brief full-screen flash or overlay acknowledging the return
- "Returning to OpenHearth…" or simply the OpenHearth logo with a fade-in

**States to design:**
- `returning` — transitioning back; brief (< 1 second)
- `home` — resolves into the full Home Screen

**Design considerations:**
- This is a micro-moment; the design should feel like a natural "popping out" of the service, not a jarring cut
- The logo or a warm-color flash reinforces brand identity at this key moment
- May not need to be a full separate screen — could be the home screen fade-in; designer should consider if any interstitial is needed at all

**PRD refs:** FR-A3, FR-R3, NFR-5, issue #26

---

## Screen 6 — Movie Detail

**Role:** Full detail view for a single movie in the local library. Entry point to playback.

**Primary content:**
- **Background/hero:** large background art (backdrop image from metadata, or the poster blurred/darkened), full-bleed
- **Poster:** prominent portrait poster image (left or center), overlaying the background
- **Metadata panel (right of or below poster):**
  - Title (large)
  - Year, runtime
  - Synopsis/description (capped to a few lines; full text may overflow off-screen)
  - Genre tags (optional)
- **Action bar (bottom or below metadata):**
  - Primary CTA: "▶ Play" — default focused element on entry
  - Secondary CTA: "↩ Resume from X:XX" (only shown if resume position exists)
  - Subtitle track selector (if available)
- **Back navigation:** back to the library or home row it was browsed from

**States to design:**
- `default` — Play is focused; resume button absent or present depending on watch state
- `resume-available` — two CTAs visible: Resume (default focused) and Start from Beginning
- `no-metadata` — no artwork available; degraded tile design using filename-derived title, neutral placeholder art
- `loading` — skeleton state while metadata resolves

**Design considerations:**
- This is a key moment — the user is about to start watching something. The screen should build excitement: big art, full bleed, cinematic
- Typography: film title as the hero typographic element
- Synopsis should never push action buttons off-screen or out of the safe area
- All navigation on this screen is directional; the action bar buttons must be clearly reachable with arrow keys

**PRD refs:** FR-C2, FR-C5, FR-C7, FR-B1, §13, issue #33, issue #35

---

## Screen 7 — TV Show Detail

**Role:** Entry point for a TV series. Shows the show overview and lets the user select a season.

**Primary content:**
- **Hero background:** full-bleed backdrop art from metadata
- **Show poster:** portrait thumbnail
- **Metadata panel:**
  - Show title (large)
  - Number of seasons, year range
  - Synopsis/description
  - Genre tags
- **Season selector:** horizontal tab row or vertical list of season numbers; focused season is highlighted
- **Episode list (for the selected season):** appears below or beside the season selector; shows episode thumbnails, numbers, and titles
- First episode of the first season is the default focused element in the episode list

**States to design:**
- `season-picker-focused` — a season tab is focused; episode list reflects that season
- `episode-list-focused` — focus has moved into the episode list
- `no-metadata` — degraded mode; folder/filename-derived structure

**Navigation context:**
- Left/right on season tabs: change season; episode list updates
- Down from season picker: enter episode list
- Select on episode: go to Episode Detail or launch playback directly
- Back: return to the library row

**Design considerations:**
- For shows with many seasons, the season picker may need to scroll; keep the layout clean
- The episode list should show enough at a glance to choose: episode number, title, thumbnail if available
- Watched/unwatched state indication (e.g. subtle progress bar under the episode thumbnail) is worth designing even if v1 only tracks resume position for a single item at a time

**PRD refs:** FR-C6, FR-C2, issue #33

---

## Screen 8 — Episode Detail

**Role:** Full detail view for a single TV episode. Entry point to playback for that episode.

**Primary content:**
- **Hero background:** episode still/thumbnail if available; show backdrop as fallback
- **Episode metadata:**
  - Show title (subdued, above)
  - Episode title (large)
  - Season and episode number (e.g. "S2 · E4")
  - Synopsis/description for the episode
  - Runtime
- **Action bar:**
  - "▶ Play" (default focused)
  - "↩ Resume from X:XX" (if resume position exists)
  - Subtitle track selector
  - "Next Episode" (navigation forward without leaving the detail view)
  - "Previous Episode"

**States to design:**
- `default` — Play focused; no resume state
- `resume-available` — Resume is default focused
- `loading` — skeleton

**Design considerations:**
- Mirrors the Movie Detail layout but with episode-specific fields
- "Next Episode" affordance is important for binge-watching ergonomics; it should be reachable with one or two arrow presses from the Play button
- May share a component template with Movie Detail

**PRD refs:** FR-C5, FR-C6, issue #33, issue #35

---

## Screen 9 — Video Player

**Role:** Full-screen immersive media playback for local library content. The center of Strategy C.

### 9a — Player: Immersive (OSD hidden)

**Primary content:**
- Full-screen video — the only thing on screen
- Cursor is hidden
- No chrome, no UI

**States:** `playing`, `paused` (slight visual indication like a dim overlay + pause icon), `buffering`

---

### 9b — Player: OSD Active (On-Screen Display)

Appears on any keypress; auto-hides after ~3–5 seconds of inactivity.

**Primary content:**
- **Bottom bar (safe-area anchored):**
  - Progress bar (scrub bar) — full width, showing current position and total duration
  - Current time / total duration labels
  - Playback controls (centered): Rewind 10s · Play/Pause · Forward 30s
  - Stop/Exit control (exits player, returns to item detail or home)
- **Top bar (safe-area anchored):**
  - Title of what's playing (show name · episode title, or movie title)
  - Subtitle track selector (a pop-up list when activated)
- **Seek indicator:** when seeking, a large time readout appears center-screen with a thumbnail preview frame if available

**States to design:**
- `playing-osd-visible` — OSD shown; progress bar active; play/pause focused
- `paused-osd-visible` — same, but play is highlighted
- `seeking` — progress bar + seek time indicator prominently visible; may show a scrub thumbnail
- `subtitle-picker-open` — subtitle track selector expanded; focus moves into the list
- `loading/buffering` — spinner overlay while transcode catches up

**Design considerations:**
- OSD should emerge and recede smoothly (fade in/out)
- Progress bar must be readable at 10 feet — thick, high-contrast track with a clearly visible playhead
- Controls should be comfortable to reach with left/right arrows; Play/Pause is the default focused element when OSD appears
- The top bar title helps orient the user, especially when resuming
- Subtitle track selector is a secondary interaction; it should be tucked away but clearly reachable
- The overall OSD aesthetic should feel like a premium media player — dark, minimal, artwork-aware

**PRD refs:** FR-C3, FR-C4, FR-C5, FR-C7, NFR-3, issue #35

---

## Screen 10 — Resume Prompt

**Role:** Modal prompt when a user opens a media item they have already partially watched. Appears over the Item Detail screen (or as a pre-player overlay).

**Primary content:**
- Brief modal/card:
  - Title of the item
  - "Continue watching?" heading
  - Two focusable options:
    - "▶ Resume from X:XX" (default focused)
    - "↩ Start from Beginning"
- Optional: a mini progress indicator showing how far into the item they are

**States to design:**
- `visible` — two options; Resume is focused
- `choosing` — standard focus movement between the two options

**Design considerations:**
- This should feel like a friendly, unobtrusive prompt — not a roadblock
- Keep it small and centered; the item detail art should still be partially visible behind it
- X:XX should be formatted as a human-readable timestamp

**PRD refs:** FR-C5, §12.2, issue #35

---

## Screen 11 — Library: Empty State

**Role:** Shown within a library row on the Home Screen, or as the full content of a library view, when no media items are found in the configured library paths (or no library is configured at all).

**Primary content (inline row variant):**
- Row label as usual
- In place of tiles: a single "no content" placeholder tile with an icon and a brief note: e.g. "No movies found · Check your library path in config"

**Primary content (full-screen library variant, if applicable):**
- Centered illustration or icon
- Headline: "Your library is empty"
- Sub-text: a brief, friendly explanation and pointer to the config

**Design considerations:**
- Should be warm and helpful, not alarming — homelabbers understand setup steps
- Consistent with the brand tone; use an appropriate icon (folder, film strip, etc.)

**PRD refs:** §10.4, FR-C1, FR-CFG3

---

## Screen 12 — Library: Degraded / No-Metadata Tile

**Role:** How an individual library tile looks when no poster art is available (metadata provider not configured, or item not matched). This is a component state, not a full screen, but warrants specific design.

**Content:**
- Placeholder background (textured or gradient in brand colors)
- Item title (filename-derived, if no metadata), styled prominently
- Year if derivable from filename
- An icon indicating media type (film reel for movie, TV icon for episode)

**Design considerations:**
- Must be visually harmonious alongside fully-enriched tiles so a mixed-metadata library doesn't look broken
- Warm, brand-aligned placeholder — not a broken image icon

**PRD refs:** §13.2, FR-B1, issue #41

---

## Screen 15 — Settings Screen

**Role:** Full-screen configuration panel accessible from the Home Screen header. Allows the user to inspect and adjust all OpenHearth settings without leaving the UI or editing YAML directly (read-oriented in v1; write support is future work).

**Entry point:** Settings button (gear icon + label) in the Home Screen header, top-right. Reachable by navigating up from the top row, then right. Also accessible from any screen's back navigation chain.

**Layout:** Two-column — left sidebar (category nav) + right content panel.

**Sidebar categories:**
- Library — sources, scan settings
- Services — service tile list and ordering
- Playback — transcode quality, direct-play preference, subtitle defaults
- Metadata — provider, API key status
- Controls — key binding reference
- Display — theme, overscan
- Help & Docs — link to documentation

**Library panel (default active):**
- Section: Library Sources — cards for each configured source (label, path, kind); focused card has amber outline; Add Source affordance
- Section: Scan Settings — Scan on startup toggle, Watch for changes toggle, Rescan interval value
- Action: Scan library now button

**States to design:**
- `library-panel` — Library category active (default on entry) — **designed**
- `services-panel` — Services list focused
- `playback-panel` — Transcode and subtitle settings
- `metadata-panel` — Provider name + API key status (masked)
- `controls-panel` — Key binding table (read-only reference)

**Navigation context:**
- Up/Down in sidebar: switch category, content panel updates
- Right from sidebar: move focus into content panel
- Left from content panel: return focus to sidebar
- Back / Home: return to Home Screen

**Design considerations:**
- Settings is informational-first in v1; most values mirror the YAML config and are shown read-only with a note pointing to the config file
- The sidebar's amber left-border indicator clearly marks the active category at 10-foot distance
- Toggle switches use the amber fill to signal "on" — consistent with the rest of the design language
- The two-column layout is a natural TV settings pattern (cf. Apple TV, PS5, Xbox)

**PRD refs:** FR-CFG1, FR-CFG2, FR-CFG4, FR-CFG5, §10

---

## Screen 13 — Search Screen

**Role:** A text search over the local library (v1 scope; extensible to cross-service in v1.x). Accessible from the Home Screen via a configurable key binding.

**Primary content:**
- **Search input field:** top of screen; shows the current query; focused on entry
- **Results area:** tile grid of matching library items below the input, using the same tile design as library rows
- **Section header:** "Local Library" (v1 scope label; hints at future cross-service expansion)

**States to design:**
- `empty-query` — search field focused; prompt text "Search your library"; no results shown (or suggestions)
- `results` — grid of matching items; first result tile focused
- `no-results` — query returned nothing; friendly "No results for 'X'" with a brief note
- `loading` — brief spinner while results arrive

**Navigation context:**
- The search input is always reachable; directional down moves focus into the results grid
- Back from search returns to the Home Screen

**Design considerations:**
- On a 10-foot TV UI, text input is awkward without a keyboard. Since the target user has a physical keyboard, the input field should accept direct typing naturally. No on-screen keyboard required for v1.
- Keep the query input area compact at the top; the majority of the screen real estate is for results
- Results should use the same tile aesthetics as the Home Screen library rows

**PRD refs:** FR-B3, issue #43

---

## Screen 14 — Error / Server Unreachable Screen

**Role:** Full-screen fallback when the React app cannot reach the server (server not running, network error, critical failure). Distinct from the non-fatal Config Error Banner.

**Primary content:**
- OpenHearth logo
- Clear, human error message: e.g. "Can't connect to OpenHearth" with a brief suggestion ("Make sure the Docker container is running")
- Retry button or instruction to press Select to retry

**States to design:**
- `server-unreachable` — initial connection failed
- `lost-connection` — was connected, then lost (e.g. container restarted)
- `retrying` — brief "reconnecting…" state

**Design considerations:**
- This is a setup/ops problem the homelabber will understand; tone is calm and informational
- Should still look on-brand; don't ship a raw error page
- Retry should be automatic (with a countdown) and also triggerable by keypress

**PRD refs:** NFR-4, issue #48

---

## Component States Reference

These are not separate screens but must be designed as part of the component library:

| Component | States |
|---|---|
| **Service Tile** | Default · Focused (highlighted) · Loading/skeleton · No-artwork fallback |
| **Library Tile (portrait)** | Default · Focused · Loading/skeleton · No-artwork fallback · "Resume progress" indicator (progress bar underlay) |
| **Row** | Default · Focused (row active) · Loading (skeleton tiles) · Empty |
| **Focus Ring / Highlight** | Must be a single, consistent design applied to all focusable elements — clearly visible at 10 feet, consistent across all screens |
| **CTA Button** | Default · Focused · Active/pressed |
| **Text Input (search)** | Empty/placeholder · Active (cursor blinking) · Filled |
| **Modal Overlay** | Backdrop blur/dim + card |
| **Loading Spinner / Indicator** | Full-screen and inline variants |
| **Progress / Scrub Bar** | Default · Active/seeking · Buffering |

---

## Summary Table

| # | Screen | Category | Complexity |
|---|---|---|---|
| 1 | Startup / Loading | System | Low |
| 2 | Home Screen | Core | High |
| 3 | Config Error Banner | System (overlay) | Low |
| 4 | Service Launch Transition | Launcher | Medium |
| 5 | Return-to-Home Overlay | Launcher | Low |
| 6 | Movie Detail | Library / Player | Medium |
| 7 | TV Show Detail | Library | Medium |
| 8 | Episode Detail | Library / Player | Medium |
| 9a | Player — Immersive (OSD hidden) | Player | Low |
| 9b | Player — OSD Active | Player | High |
| 10 | Resume Prompt | Player (overlay) | Low |
| 11 | Library Empty State | Library | Low |
| 12 | Degraded / No-Metadata Tile | Component state | Low |
| 13 | Search Screen | Discovery | Medium |
| 14 | Error / Server Unreachable | System | Low |
| 15 | Settings | System / Config | Medium |

**Total: 16 screens / states** (15 primary + 1 component variant)

---

*Design artifacts (wireframes, focus maps, Figma files, visual-language references) should live in this `designs/` directory alongside this document. Reference the PRD requirement IDs above when annotating designs so decisions remain traceable.*
