# OpenHearth Design System

> Developer handoff reference for the OpenHearth 10-foot TV interface.  
> **Pixel values throughout this document are the 1080p (1920 × 1080) design baseline.**  
> See [§ Responsive Scaling](#responsive-scaling) for how to convert these to resolution-independent units before implementing.  
> Source designs: [`designs/designs_1.pen`](designs_1.pen)

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Responsive Scaling](#2-responsive-scaling)
3. [Canvas & Safe Area](#3-canvas--safe-area)
4. [Color System](#4-color-system)
5. [Typography](#5-typography)
6. [Spacing Scale](#6-spacing-scale)
7. [Border Radius](#7-border-radius)
8. [Elevation & Shadow](#8-elevation--shadow)
9. [Focus System](#9-focus-system)
10. [Iconography](#10-iconography)
11. [Components](#11-components)
    - [Service Tile](#service-tile)
    - [Library Tile (Portrait)](#library-tile-portrait)
    - [CTA Button — Primary](#cta-button--primary)
    - [CTA Button — Secondary](#cta-button--secondary)
    - [Row Header](#row-header)
    - [Content Row](#content-row)
    - [Progress / Scrub Bar](#progress--scrub-bar)
    - [Toggle Switch](#toggle-switch)
    - [Text Input (Search)](#text-input-search)
    - [Modal Card](#modal-card)
    - [Error / Info Banner](#error--info-banner)
    - [Settings Nav Item](#settings-nav-item)
    - [Settings Source Card](#settings-source-card)
12. [Screen Specifications](#12-screen-specifications)
    - [01 Startup / Loading](#01-startup--loading)
    - [02 Home Screen](#02-home-screen)
    - [03 Config Error Banner](#03-config-error-banner)
    - [04 Service Launch Transition](#04-service-launch-transition)
    - [05 Return-to-Home Overlay](#05-return-to-home-overlay)
    - [06 Movie Detail](#06-movie-detail)
    - [07 TV Show Detail](#07-tv-show-detail)
    - [08 Episode Detail](#08-episode-detail)
    - [09a Player — Immersive](#09a-player--immersive)
    - [09b Player — OSD Active](#09b-player--osd-active)
    - [10 Resume Prompt](#10-resume-prompt)
    - [11 Library Empty State](#11-library-empty-state)
    - [12 No-Metadata Tile](#12-no-metadata-tile)
    - [13 Search Screen](#13-search-screen)
    - [14 Error / Server Unreachable](#14-error--server-unreachable)
    - [15 Settings](#15-settings)
13. [Navigation Model](#13-navigation-model)
14. [Motion & Transitions](#14-motion--transitions)
15. [Degraded States](#15-degraded-states)

---

## 1. Design Philosophy

**Modern, cinematic, comfortable.** OpenHearth lives in a dark living room on a 55"+ screen viewed from 10 feet away. Every decision is made for that context.

| Principle | Implementation |
|---|---|
| **Dark-first** | Near-black canvas (`#08080E`) lets artwork pop without competition |
| **Warm identity** | Amber/ember accent palette — the hearth is the brand |
| **Artwork-first** | Posters and backdrops are the visual heroes; chrome steps back |
| **Focus clarity** | The focused element must be unambiguously clear at 10 feet — amber ring + glow, always |
| **Generous scale** | Typography and touch targets sized for viewing distance, not mouse precision |
| **No cursor** | All navigation is directional (up/down/left/right + select/back/home); nothing requires a pointer |

---

## 2. Responsive Scaling

### The problem

The design was laid out at **1920 × 1080 px** (1080p). OpenHearth users may connect to:

| Resolution | CSS pixels (DPR=1) | Notes |
|---|---|---|
| 720p | 1280 × 720 | Older sets, small bedroom TVs |
| **1080p** | **1920 × 1080** | **Design baseline** |
| 1440p | 2560 × 1440 | Some PC monitors used as TVs |
| 4K / UHD | 3840 × 2160 | Increasingly common |

In a Chromium kiosk launched with `--kiosk --app=http://localhost:8080`, the browser viewport is the **native screen resolution** (DPR is typically 1 on mini-PC / HTPC setups). This means the same 80px safe-area margin that looks right at 1080p will look tiny and wrong at 4K, and will eat into usable space at 720p.

### The solution: `1vw` root scale

Set the root font size to `1vw`. This makes `1rem = 1% of viewport width` at every resolution.

```css
:root {
  font-size: 1vw;
}
```

| Resolution | 1vw = 1rem | Scaling factor vs 1080p |
|---|---|---|
| 720p (1280px) | 12.8 px | ×0.667 |
| **1080p (1920px)** | **19.2 px** | **×1.000 (baseline)** |
| 1440p (2560px) | 25.6 px | ×1.333 |
| 4K (3840px) | 38.4 px | ×2.000 |

Every `rem` value then scales proportionally — a `3.125rem` title is always `~60px` worth of visual weight relative to the screen, regardless of resolution.

### Conversion formula

```
rem value = px value (at 1080p) / 19.2
```

For quick mental math: **divide by ~20**.

| 1080p px | rem |
|---|---|
| 4 px | 0.208rem |
| 8 px | 0.417rem |
| 12 px | 0.625rem |
| 14 px | 0.729rem |
| 16 px | 0.833rem |
| 18 px | 0.938rem |
| 20 px | 1.042rem |
| 24 px | 1.25rem |
| 28 px | 1.458rem |
| 32 px | 1.667rem |
| 40 px | 2.083rem |
| 48 px | 2.5rem |
| 52 px | 2.708rem |
| 54 px | 2.813rem |
| 56 px | 2.917rem |
| 60 px | 3.125rem |
| 64 px | 3.333rem |
| 72 px | 3.75rem |
| 80 px | 4.167rem |
| 96 px | 5rem |
| 120 px | 6.25rem |
| 140 px | 7.292rem |
| 170 px | 8.854rem |
| 210 px | 10.938rem |
| 280 px | 14.583rem |
| 320 px | 16.667rem |
| 420 px | 21.875rem |
| 600 px | 31.25rem |
| 900 px | 46.875rem |
| 1760 px | 91.667rem |

### What scales (use rem or vw/vh)

| Category | Unit to use | Reasoning |
|---|---|---|
| **Typography** | `rem` | Must scale — readability is viewing-distance dependent |
| **Spacing / padding / gaps** | `rem` | Proportional spacing preserves layout rhythm |
| **Tile dimensions** (width, height) | `rem` | Tiles must scale to fill the screen proportionally |
| **Safe area margins** | `rem` (or `4.167vw` / `2.813vh`) | Proportional inset from screen edges |
| **Icon sizes** | `rem` | Icons must match the text they accompany |
| **Modal / card dimensions** | `rem` | Cards should scale relative to screen size |
| **Screen/frame dimensions** | `100vw` / `100vh` | Always exactly the viewport |
| **Poster aspect ratios** | Maintain with `aspect-ratio` CSS property | Don't hard-code both dimensions |

### What stays in pixels (do NOT convert)

| Category | Why |
|---|---|
| **Border widths** (`1px`, `2px`, `3px` focus rings) | Sub-pixel rendering handles this; a 3px border looks correct at every DPR |
| **Box-shadow blur and spread** | Shadow softness is perceptual; `20px` blur reads fine at 4K |
| **Border-radius** (`6px`, `10px`, `12px`, `20px`) | Subtle rounding — the difference between `12px` and `24px` at 4K is not meaningful enough to scale |
| **Scrollbar widths** | Browser-controlled |
| **Animation durations** | Time is absolute — `200ms` is `200ms` regardless of screen size |

> **Rule of thumb:** if it controls *layout size or reading comfort*, use rem. If it controls *visual refinement* (edges, glows, corners), `px` is fine.

### CSS custom properties for the token system

Define all design tokens as CSS custom properties derived from rem:

```css
:root {
  font-size: 1vw; /* 1rem = 1% of viewport width */

  /* Backgrounds */
  --color-bg-primary:    #08080E;
  --color-bg-surface:    #0F0F1A;
  --color-bg-elevated:   #181826;
  --color-bg-overlay:    rgba(0, 0, 0, 0.800);
  --color-tile-bg:       #1C1C28;

  /* Accents */
  --color-accent-amber:     #F5A623;
  --color-accent-ember:     #D4622C;
  --color-accent-amber-dim: rgba(245, 166, 35, 0.267);

  /* Text */
  --color-text-primary:   #F0EEE8;
  --color-text-secondary: #9896A0;
  --color-text-muted:     #5A5864;
  --color-text-accent:    #F5A623;

  /* Semantic */
  --color-focus-ring:  #F5A623;
  --color-separator:   rgba(255, 255, 255, 0.094);
  --color-error:       #E04C2A;
  --color-warning:     #F5A623;
  --color-success:     #4CAF7A;

  /* Safe area — rem values derived from 80px and 54px at 1080p baseline */
  --safe-h: 4.167rem;   /* horizontal: 80px ÷ 19.2 */
  --safe-v: 2.813rem;   /* vertical:   54px ÷ 19.2 */

  /* Border radius — kept in px (see scaling rationale above) */
  --radius-sm:  6px;
  --radius-md:  12px;
  --radius-lg:  20px;

  /* Typography */
  --font-display: 'Inter', sans-serif;

  /* Focus ring — kept in px */
  --focus-ring-width:  3px;
  --focus-ring-color:  #F5A623;
  --focus-ring-glow:   0 0 0 8px rgba(245, 166, 35, 0.40),
                       0 0 20px rgba(245, 166, 35, 0.40);
}
```

### Poster aspect ratio

Do not hard-code both width and height on library tiles. Set width in rem and let the height derive from `aspect-ratio`:

```css
.library-tile__poster {
  width: 7.292rem;        /* 140px ÷ 19.2 */
  aspect-ratio: 2 / 3;   /* standard movie poster ratio */
  border-radius: var(--radius-md);
}

.library-tile__poster--focused {
  width: 7.708rem;        /* 148px — slight scale up on focus */
}
```

### A note on 4K

At 4K with DPR=1 (the typical mini-PC / HTPC scenario), `1vw = 38.4px`. The entire UI will render at double the pixel density compared to 1080p, which is correct and desirable — text and tiles will be physically the same size on the screen but rendered at higher fidelity. No special-casing is needed.

If the OS applies display scaling (e.g., Windows at 150% on a 4K screen), the browser inherits that DPR and CSS pixels are already scaled — in that case `1vw` still equals 1% of the CSS viewport width, which is already the "right" size. The approach works either way.

---

## 3. Canvas & Safe Area

### Frame size
All screens are designed at **1920 × 1080 px** (1080p). Scale proportionally for 4K.

### TV Safe Area
Content that must be visible on all displays (including those with overscan) must stay within the **safe zone**:

| Axis | Margin token | Value | Safe content width/height |
|---|---|---|---|
| Horizontal | `tv-safe-h` | **80 px** each side | 1760 px wide |
| Vertical | `tv-safe-v` | **54 px** each side | 972 px tall |

All text, interactive controls, and meaningful content must be within this zone. Purely decorative background gradients and images may bleed to the full 1920 × 1080 frame.

```
┌─────────────────────────────────────────┐  ← 1920px
│  80px                              80px │
│  ┌───────────────────────────────────┐  │  ← 54px
│  │                                   │  │
│  │         SAFE CONTENT ZONE         │  │
│  │           1760 × 972 px           │  │
│  │                                   │  │
│  └───────────────────────────────────┘  │  ← 54px
│                                         │
└─────────────────────────────────────────┘
```

---

## 4. Color System

All color values are defined as design tokens. Reference them by token name in code (CSS custom properties, Tailwind theme, etc.).

### Background Colors

| Token | Hex | Usage |
|---|---|---|
| `bg-primary` | `#08080E` | Default screen background |
| `bg-surface` | `#0F0F1A` | Slightly elevated surface (sidebar background alternative) |
| `bg-elevated` | `#181826` | Cards, modals, settings sidebar |
| `bg-overlay` | `#000000CC` | Translucent overlay behind modals |
| `tile-bg` | `#1C1C28` | Placeholder background for tiles without artwork |

### Accent Colors

| Token | Hex | Usage |
|---|---|---|
| `accent-amber` | `#F5A623` | Primary interactive accent: focused elements, CTAs, active states, progress fills, amber toggles |
| `accent-ember` | `#D4622C` | Secondary accent: gradient endpoints, destructive hints, launch-transition accents |
| `accent-amber-dim` | `#F5A62344` | Glow halos, ambient shadows, subtle hover fills |

> **Brand gradient:** `linear-gradient(180deg, #F5A623 0%, #D4622C 100%)` — used on the logo mark, primary buttons, and progress fills.

### Text Colors

| Token | Hex | Usage |
|---|---|---|
| `text-primary` | `#F0EEE8` | Headings, titles, primary content — warm white, not pure |
| `text-secondary` | `#9896A0` | Metadata, labels, secondary information |
| `text-muted` | `#5A5864` | Row headers, hints, placeholders, timestamps |
| `text-accent` | `#F5A623` | Focused tile labels, active nav items, highlighted values |

### Semantic Colors

| Token | Hex | Usage |
|---|---|---|
| `focus-ring` | `#F5A623` | Focus indicator border — same as `accent-amber` by design |
| `separator` | `#FFFFFF18` | Horizontal rules, subtle dividers |
| `error` | `#E04C2A` | Error icons, destructive state indicators |
| `warning` | `#F5A623` | Warning banner (reuses amber — matches brand and "caution" association) |
| `success` | `#4CAF7A` | Success states (reserved; not yet used in v1 screens) |

### Overlay Patterns

Several screens use semi-transparent gradients over artwork or video. These are not tokens but recurring patterns:

**Scrim — bottom fade (detail screens):**
```
linear-gradient(to top, #000000FF 0%, #000000EE 50%, #000000BB 80%, transparent 100%)
```

**Scrim — OSD bottom (player):**
```
linear-gradient(to top, #000000F0 0%, transparent 100%) — height 300px
```

**Scrim — OSD top (player):**
```
linear-gradient(to bottom, #000000CC 0%, transparent 100%) — height 180px
```

**Ambient background glow (home screen):**
```
radial-gradient(ellipse at 70% 30%, #2A1F0E22 0%, transparent 60%)
```

---

## 5. Typography

### Typeface
**Inter** (Google Fonts) — used for all text across the entire interface.

- Rationale: clean at all sizes, excellent legibility at distance, wide weight range, freely available
- All font weights available: 300 (Light), 400 (Regular), 600 (SemiBold), 700 (Bold), 800 (ExtraBold)

### Type Scale

| Role | Size | Weight | Color token | Letter spacing | Notes |
|---|---|---|---|---|---|
| **Wordmark** | 52 px | 300 | `text-primary` | 12 px | Startup screen only |
| **Screen wordmark (header)** | 22 px | 300 | `text-primary` | 6 px | All screen headers |
| **Detail title (movie/show)** | 56–64 px | 700 | `text-primary` | 0 | Hero typographic element |
| **Episode title** | 56 px | 700 | `text-primary` | 0 | Episode detail screen |
| **Settings panel title** | 28 px | 700 | `text-primary` | 0 | Settings right panel |
| **OSD title** | 20 px | 600 | `text-primary` | 0 | Player top bar |
| **OSD subtitle** | 16 px | 400 | `text-secondary` | 0 | Show/series context in player |
| **Tile title** | 12–13 px | 600 | `text-primary` | 0 | Library tile below poster |
| **Tile year** | 11–12 px | 400 | `text-muted` | 0 | Library tile below title |
| **Row header** | 14 px | 600 | `text-muted` | 3 px | ALL CAPS, uppercase in content |
| **Section label** | 12–13 px | 400 | `text-muted` | 2 px | ALL CAPS, settings panel sub-headings |
| **Body / synopsis** | 16–17 px | 400 | `text-secondary` | 0 | Line height: 1.6× |
| **Metadata line** | 17–18 px | 400 | `text-secondary` | 0 | Year · Runtime · Rating |
| **Button label (primary)** | 20 px | 700 | `#08080E` | 0 | On amber button |
| **Button label (secondary)** | 18–20 px | 600 | `text-primary` | 0 | On ghost button |
| **Settings nav item** | 17 px | 400 / 600 | `text-secondary` / `text-primary` | 0 | 600 weight when active |
| **Clock / ambient** | 18 px | 400 | `text-secondary` | 0 | Header right side |
| **Hint text** | 13–14 px | 400 | `text-muted` | 0–2 px | "Press Home to return", back hints |
| **Tagline** | 16 px | 400 | `text-muted` | 4 px | Startup screen only, ALL CAPS |
| **Countdown / numeric emphasis** | 28 px | 700 | `text-accent` | 0 | Error screen retry countdown |

### Text Wrapping
- Titles and synopses must never overflow the safe area. Clamp synopsis to 2–3 lines if needed.
- Tile titles use `text-overflow: ellipsis` after 1 line (library row), or 2 lines max (search results).
- Player OSD title uses single-line with ellipsis.

---

## 6. Spacing Scale

The interface does not use a strict 8-pt grid, but spacing clusters around these values:

| Size | px | Typical usage |
|---|---|---|
| XS | 4 | Tag/badge internal padding (vertical) |
| S | 8–10 | Icon-to-label gap, tight metadata rows |
| M | 12–16 | Button internal gaps, tile-to-label gap, row gaps between small items |
| L | 20–24 | CTA button padding (vertical 20, horizontal 40–48), card internal padding |
| XL | 28–32 | Section gaps within a panel |
| 2XL | 40–48 | Between major sections on a screen |
| 3XL | 54–80 | Safe area margins, header vertical padding |

---

## 7. Border Radius

| Token | Value | Usage |
|---|---|---|
| `border-radius-sm` | 6 px | Tags, genre badges, rating badge, small pill elements |
| `border-radius-md` | 12 px | Source cards, search input, settings panels |
| `border-radius-lg` | 20 px | Modal card, launch transition service tile, logo mark (large variant) |

Additional values used in context:
- **Logo mark (header):** 8 px
- **Library tile poster:** 8 px
- **Service tile artwork:** 10 px
- **CTA button:** 10 px
- **Toggle track:** 14 px (pill — height/2)
- **Play/Pause button (player OSD):** 36 px (full circle — width/2)
- **Return hint pill:** 40 px (full pill)

---

## 8. Elevation & Shadow

Shadows reinforce focus and depth hierarchy. Only applied where they add meaning.

### Focus glow (most important)
Applied to any focused interactive element:
```
box-shadow: 0 0 0 8px #F5A62366, 0 0 20px #F5A62366
```
Stroke: `3px solid #F5A623`

### Primary CTA button glow
```
box-shadow: 0 0 20px #F5A62344
```

### Play/Pause button (OSD)
```
box-shadow: 0 0 24px #F5A62355
```

### Modal card shadow
```
box-shadow: 0 24px 80px #000000AA
```

### Service launch glow (service-specific color)
```
box-shadow: 0 0 60px <service-color>66
```

### Settings source card (focused)
```
border: 2px solid #F5A623
```
No additional glow — clean, form-like treatment.

---

## 9. Focus System

The focus system is **the most critical part of this interface**. Every interactive element must have a clearly visible focus state at 10-foot viewing distance.

### Rules

1. **One focused element at all times.** Focus never disappears; it merely moves.
2. **Amber ring + glow:** All focusable elements use `3px solid #F5A623` border plus an outer glow shadow `0 0 20px #F5A62366`.
3. **Label color change:** The text label of a focused tile or nav item changes from `text-secondary` to `text-accent` (`#F5A623`).
4. **Scale:** Focused library tiles scale slightly (148 × 220 px vs 140 × 210 px default) to further emphasise selection.
5. **Consistent ring color:** The focus ring is always amber — never changes per screen or per service brand color.

### Focus State Anatomy

```
┌─────────────────────────────┐
│  ← 3px amber border         │  ← border: 3px solid #F5A623
│  ┌───────────────────────┐  │
│  │                       │  │  ← outer glow: 0 0 20px #F5A62366
│  │    Focused element    │  │
│  │                       │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
          Label text           ← color: #F5A623
```

### Navigation Logic
- **Left/Right:** Move within a row (services, library tiles, episode list, settings panel)
- **Up/Down:** Move between rows on Home Screen; between sidebar categories in Settings
- **Up from top row:** Focus jumps to the header (Settings button, Search icon, Clock area)
- **Select (Enter):** Activate focused element
- **Back (Backspace/Escape):** Go back one level
- **Home:** Always returns to Home Screen — intercepted by the kiosk before reaching any launched service

---

## 10. Iconography

**Library:** [Lucide Icons](https://lucide.dev) — open source, consistent stroke weight, excellent at small sizes.

Icons render at `fill` color (no separate stroke property) in the Pencil design system. In CSS/SVG, use `stroke` with `stroke-width: 1.5` (Lucide default).

### Icon sizes in use

| Context | Size | Color token |
|---|---|---|
| Header icons (search, settings gear) | 20–24 px | `text-secondary` |
| Sidebar nav icons | 20 px | `text-muted` (default) / `text-accent` (active) |
| Banner warning icon | 20 px | `accent-amber` |
| Empty state icons | 32 px | `text-muted` |
| Error state icon (`wifi-off`) | 36 px | `error` |
| Player OSD subtitle icon | 18 px | `text-primary` |
| Degraded tile media-type icon | 40 px | `#FFFFFF22` (ghost) |
| CTA button icons (search, refresh) | 18–20 px | Inherited from button context |

### Icons referenced in designs

| Icon name (Lucide) | Usage |
|---|---|
| `settings` | Header Settings button |
| `search` | Header search, Search screen input |
| `captions` | Subtitle selector |
| `triangle-alert` | Config error banner |
| `house` | "Press Home to return" hint on launch transition |
| `folder-open` | Library empty state (movies) |
| `tv` | Library empty state (TV shows) / degraded TV tile |
| `film` | Degraded movie tile |
| `folder` | Settings — library source card |
| `hard-drive` | Settings sidebar — Library category |
| `layout-grid` | Settings sidebar — Services category |
| `circle-play` | Settings sidebar — Playback category |
| `database` | Settings sidebar — Metadata category |
| `keyboard` | Settings sidebar — Controls category |
| `monitor` | Settings sidebar — Display category |
| `book-open` | Settings sidebar — Help & Docs |
| `chevron-left` | Episode detail — Previous episode |
| `chevron-right` | Episode detail — Next episode |
| `chevron-down` | Player OSD subtitle selector |
| `rotate-ccw` | Player OSD — Skip back 10s |
| `rotate-cw` | Player OSD — Skip forward 30s |
| `square` | Player OSD — Stop |
| `wifi-off` | Error / Server Unreachable |
| `terminal` | Error screen — docker hint |
| `refresh-cw` | Error screen retry / Settings scan now |
| `plus` | Settings — Add library source |
| `info` | (reserved for About nav item alternative) |

---

## 11. Components

### Service Tile

Represents a streaming service on the Home Screen. Landscape / 16:9 artwork.

#### Default state
```
Container: vertical flex, gap 10px, align-items center, width 170px
  Artwork frame: 170 × 96 px, border-radius 10px, fill: tile-bg (#1C1C28), clip
    [Service logo / artwork fills frame]
  Label text: 13px, text-secondary, Inter 400
```

#### Focused state
```
Container: same
  Artwork frame: same dimensions + border: 3px solid #F5A623
                 box-shadow: 0 0 0 8px #F5A62355, 0 0 20px #F5A62355
  Label text: 13px, text-accent (#F5A623), Inter 700
```

#### Loading / skeleton state
```
Artwork frame: fill with animated shimmer gradient:
  linear-gradient(90deg, #1C1C28 0%, #252535 50%, #1C1C28 100%)
Label: hidden or shimmer bar
```

---

### Library Tile (Portrait)

Represents a movie or TV show in the library. Portrait / poster aspect ratio.

#### Default state
```
Container: vertical flex, gap 8px, align-items center, width 140px
  Poster frame: 140 × 210 px, border-radius 8px, fill: tile-bg (#1C1C28), clip
    [Poster artwork fills frame]
  Info block: vertical flex, gap 2px, width 140px
    Title: 12px, text-primary, Inter 600, 1-line ellipsis
    Year:  11px, text-muted, Inter 400
```

#### Focused state
```
Container: vertical flex, gap 8px, align-items center, width 148px
  Poster frame: 148 × 220 px (slightly scaled up), border-radius 8px
                border: 3px solid #F5A623
                box-shadow: 0 0 0 8px #F5A62366, 0 0 20px #F5A62366
  Info block: width 148px
    Title: 12px, text-accent (#F5A623), Inter 700
    Year:  11px, text-secondary, Inter 400
```

#### Resume progress indicator
For items with a saved position, show a thin progress bar at the bottom of the poster:
```
position: absolute, bottom 0, left 0, right 0
height: 3px
background: rgba(255,255,255,0.15)
  [Fill bar]: width proportional to progress, background: #F5A623
```

---

### CTA Button — Primary

Used for Play, Resume (when it is the primary action).

```
Container: horizontal flex, gap 12px, padding 20px 48px, border-radius 10px
           background: #F5A623
           box-shadow: 0 0 20px #F5A62344
  Icon: 22px, color #08080E, weight 700 (▶ or ↩)
  Label: 20px, Inter 700, color #08080E
```

#### Focused state
Add outer glow:
```
box-shadow: 0 0 20px #F5A62344, 0 0 0 3px #F5A623, 0 0 32px #F5A62366
```

#### Minimum width
Buttons should never be narrower than their label + icon + padding. Do not set a fixed width unless needed for grid alignment.

---

### CTA Button — Secondary

Used for Resume (secondary), Start from Beginning, Subtitles, Stop, etc.

```
Container: horizontal flex, gap 10–12px, padding 18–20px 28–40px, border-radius 10px
           background: rgba(255,255,255,0.094)  [#FFFFFF18]
           border: 1px solid rgba(255,255,255,0.188)  [#FFFFFF30]
  Icon: 20–22px, color text-primary
  Label: 18–20px, Inter 600, color text-primary
```

#### Focused state
```
border: 3px solid #F5A623
box-shadow: 0 0 20px #F5A62355
```

---

### Row Header

Label above each horizontal tile strip on the Home Screen.

```
Text: 14px, Inter 600, text-muted (#5A5864), letter-spacing 3px
      ALL CAPS (apply text-transform: uppercase in CSS)
Margin-bottom: 16px before the tile strip
```

---

### Content Row

A labeled horizontal strip of tiles, used on Home Screen and Library views.

```
Container: vertical flex, gap 16px, full width
  Row Header (see above)
  Tile strip: horizontal flex, gap 16px
    [Tiles — Service or Library, as appropriate]
```

Off-screen tiles should be clipped at the right edge with a fade hint (`-webkit-mask: linear-gradient(to right, black 85%, transparent 100%)`) to signal scrollability, but the row never actually scrolls in the DOM — focus navigation moves the viewport / logical position.

---

### Progress / Scrub Bar

Used in the Player OSD (full-width) and Resume Prompt (mini).

#### Full-width (Player OSD)

```
Track: full width (1760px inside safe area), height 6px, border-radius 3px
       background: rgba(255,255,255,0.188)  [#FFFFFF30]
  Fill: width proportional to position, height 6px, border-radius 3px
        background: linear-gradient(90deg, #F5A623 0%, #D4622C 100%)
  Playhead: 18 × 18px circle, border-radius 9px, background #F5A623
            position: absolute, left = fill width − 9px, top = −6px
            box-shadow: 0 0 8px #F5A62388
```

Time labels below track:
```
Row: horizontal flex, space-between, full width
  Current time: 16px, text-primary, Inter 400
  Total time: 16px, text-secondary, Inter 400
```

#### Mini (Resume Prompt modal)

```
Track: full width of modal content area, height 4px, border-radius 2px
       background: rgba(255,255,255,0.125)  [#FFFFFF20]
  Fill: width proportional to position, height 4px, background #F5A623
Time labels: same row layout, 13px
  Current position: text-accent
  Total duration: text-muted
```

---

### Toggle Switch

Used in Settings — Scan Settings panel.

```
Track: 52 × 28px, border-radius 14px
  ON:  background #F5A623
  OFF: background rgba(255,255,255,0.12)
Knob: 22 × 22px circle, border-radius 11px, background #08080E
  ON:  left offset 27px, top 3px
  OFF: left offset 3px, top 3px
```

Transition: `left 150ms ease-out` on the knob.

---

### Text Input (Search)

Used on the Search Screen.

```
Container: horizontal flex, gap 16px, padding 20px 28px, border-radius 12px
           background: bg-elevated (#181826)
           border: 2px solid #F5A623  [always focused on entry to this screen]
  Search icon: 24px lucide search, color text-accent
  Query text: 24px, text-primary, Inter 400 (or placeholder: text-muted)
  Blinking cursor: 2 × 28px rectangle, border-radius 1px, background #F5A623
                   animation: blink 1s step-end infinite
  Result count: 16px, text-muted, Inter 400 (right-aligned, auto margin-left)
```

---

### Modal Card

Used for Resume Prompt and any future confirmation dialogs.

```
Card: vertical flex, gap 32px, padding 48px 64px, width 600px
      border-radius 20px
      background: bg-elevated (#181826)
      border: 1px solid rgba(255,255,255,0.078)  [#FFFFFF14]
      box-shadow: 0 24px 80px rgba(0,0,0,0.667)
Backdrop: full-screen, background rgba(0,0,0,0.667), backdrop-filter: blur(16px)
```

Always centered on screen (both axes). Focus trap is active while modal is open.

---

### Error / Info Banner

Anchored to the bottom edge of the screen. Non-modal, non-blocking.

```
Banner: position fixed/absolute, bottom 0, left 0, right 0, height 72px
        background: rgba(42,24,0,0.933)  [#2A1800EE]
        layout: horizontal flex, padding 0 80px, gap 16px, align-items center, space-between
  Top accent line: position absolute, top 0, full width, height 3px, background #F5A623
  Left group (horizontal flex, gap 16px):
    Icon: 20px lucide triangle-alert, color #F5A623
    Message text: 15px, text-primary, Inter 400
  Right group (horizontal flex, gap 24px):
    Detail hint: 13px, text-muted ("Press ⊙ for details")
    Dismiss: 13px, text-accent, Inter 400 — focusable
```

Variants:
- **Warning (config error):** amber top line + amber icon — shown above
- Auto-dismiss after config becomes valid; also manually dismissible via Select on the Dismiss label.

---

### Settings Nav Item

Left sidebar navigation item in the Settings screen.

#### Default state
```
Container: horizontal flex, gap 16px, padding 16px 20px, border-radius 10px
           background: transparent, width: fill
  Icon: 20px lucide, color text-muted
  Label: 17px, text-secondary, Inter 400
```

#### Active (selected category) state
```
Container: background rgba(255,255,255,0.059) [#FFFFFF0F]
           border: 1px solid rgba(255,255,255,0.078) [#FFFFFF14]
  Left indicator: position absolute, left 0, top 14px, width 3px, height 20px
                  border-radius 2px, background #F5A623
  Icon: color text-accent (#F5A623)
  Label: Inter 600, color text-primary
```

#### Focused state (navigating within sidebar)
Add:
```
border: 2px solid #F5A623
box-shadow: 0 0 12px #F5A62344
```

---

### Settings Source Card

Represents a configured library source in the Settings → Library panel.

```
Card: vertical flex, width full, border-radius 12px, background bg-elevated (#181826)
  Header row: horizontal flex, padding 20px 24px, align-items center, space-between
    Left (horizontal flex, gap 16px):
      Icon: 20px lucide folder, color text-muted (or text-accent when focused)
      Meta block (vertical flex, gap 4px):
        Label: 17px, text-primary, Inter 600
        Path:  14px, text-muted, Inter 400
    Right:
      Kind badge: horizontal flex, padding 6px 14px, border-radius 20px
                  background rgba(255,255,255,0.039)
                  border: 1px solid rgba(255,255,255,0.078)
        Text: 13px, text-secondary, "kind: movies"
```

#### Focused card state
```
border: 2px solid #F5A623  (replacing default: 1px solid rgba(255,255,255,0.071))
```

---

## 12. Screen Specifications

All screens are 1920 × 1080 px. Only layout-critical measurements are listed; see the `.pen` file for exact component positioning.

---

### 01 Startup / Loading

**Purpose:** First frame shown while the server connection is being established.

**Layout:** Full-screen vertical flex, justify-center, align-center, gap 48px.

```
Background: solid bg-primary (#08080E)

Logo Area (vertical flex, gap 16px, centered):
  Flame icon: 56 × 56px, border-radius 14px
              background: linear-gradient(180deg, #F5A623 0%, #D4622C 100%)
  Wordmark: "OPENHEARTH", 52px, Inter 300, text-primary, letter-spacing 12px
  Tagline: "YOUR LIVING ROOM. YOUR RULES.", 16px, text-muted, letter-spacing 4px

Loader Track: 120 × 2px, border-radius 1px, background #FFFFFF18
  Loader Fill: 60 × 2px (animated), background: linear-gradient(90deg, #F5A623, #D4622C)

Status text: "CONNECTING", 13px, text-muted, letter-spacing 2px
```

**States:**
- `loading` — loader fill animates left-to-right, status text "CONNECTING"
- `error` — swap status text for "Unable to connect · Check your setup", surface a retry hint

**Animation:** Loader fill slides from 0% to ~40% width slowly (indeterminate), then re-runs. Status text fade-in after 300ms.

---

### 02 Home Screen

**Purpose:** Primary hub. The user always returns here.

```
Background: bg-primary + radial ambient glow (warm, top-right, very subtle)

Header (horizontal flex, space-between, padding 54px 80px 24px 80px):
  Left — Logo Group (horizontal flex, gap 12px):
    Logo mark: 32 × 32px, border-radius 8px, amber-ember gradient
    Wordmark: "OPENHEARTH", 22px, Inter 300, text-primary, letter-spacing 6px
  Right — Header Actions (horizontal flex, gap 32–40px, align-center):
    Clock: 18px, text-secondary
    Search icon: 24px lucide search, text-secondary — focusable
    Settings button: horizontal flex, gap 10px, padding 10px 20px, border-radius 8px
                     background #FFFFFF0F, border 1px solid #FFFFFF18
      Gear icon: 20px lucide settings, text-secondary
      "Settings" label: 15px, text-secondary

Content Area (vertical flex, padding 12px 80px 54px 80px, gap 40px, fill height):
  Row 1 — Streaming Services
    Row header: "STREAMING SERVICES"
    Tiles: horizontal flex, gap 16px — Service Tiles (170 × 96px artwork)
  Row 2 — Movies
    Row header: "MOVIES"
    Tiles: horizontal flex, gap 16px — Library Tiles (120 × 180px poster)
  Row 3 — TV Shows
    Row header: "TV SHOWS"
    Tiles: horizontal flex, gap 16px — Library Tiles (120 × 180px poster)
```

**Focus entry:** First tile in the Streaming Services row (first service, e.g. Netflix).

**Key measurements:**
- Header height: ~132px (54px top padding + content + 24px bottom padding)
- Content rows start at ~132px from top
- Tile rows separated by 40px gap
- Each library tile + info ≈ 210px poster + 8px gap + ~30px info = 248px total tile height

---

### 03 Config Error Banner

**Purpose:** Non-fatal overlay indicating a config validation error. Layered on top of any screen.

The base screen shows the normal Home Screen content. The banner is absolutely positioned at the bottom:

```
Error Banner: position absolute, bottom 0, full width, height 72px
  [See Error / Info Banner component spec]
  Message: "Config error in services.yaml — using last valid settings"
```

The banner does not block navigation; it is focusable at the bottom of the focus order (user can tab/navigate down to reach Dismiss).

---

### 04 Service Launch Transition

**Purpose:** Transitional screen between selecting a service tile and the service's web player taking over the kiosk.

```
Background: #000000 full screen

Dark overlay: radial gradient from transparent center to opaque edges (vignette feel)
Service BG Glow: large blurred ellipse in service's brand color, center screen

Center Content (vertical flex, gap 24–32px, centered):
  Service Logo Area: 320 × 180px, border-radius 20px
                     background: <service brand color>
                     box-shadow: 0 0 60px <service-color>66
    [Service logo / name inside]
  "LAUNCHING [SERVICE]" text: 20px, text-secondary, letter-spacing 4px
  Loader track: 200 × 3px, service-colored fill animated
  Return Hint pill (horizontal flex, gap 12px, padding 14px 24px, border-radius 40px):
    background rgba(255,255,255,0.094)
    House icon: 18px lucide house, text-secondary
    "Press Home to return to OpenHearth": 15px, text-secondary
```

**Animation sequence:**
1. Service tile expands/zooms to fill screen (300ms ease-out)
2. Service logo area fades in, loader begins (200ms)
3. Return hint fades in (300ms delay), then auto-fades after 4 seconds
4. Once the service URL is navigated, OpenHearth chrome disappears entirely

---

### 05 Return-to-Home Overlay

**Purpose:** Brief overlay confirming the user is returning from a launched service to OpenHearth. Appears when the reserved Home/Back key is pressed inside a launched service.

```
Background: #000000 + warm radial glow (amber/brown center)

Return Logo (vertical flex, gap 20px, centered):
  Logo mark large: 72 × 72px, border-radius 18px, amber-ember gradient
                   box-shadow: 0 0 40px #F5A62355
  Wordmark: "OPENHEARTH", 36px, Inter 300, text-primary, letter-spacing 10px
  "RETURNING TO HOME" text: 16px, text-muted, letter-spacing 3px

Loader: 160 × 2px track, amber fill animating to full width
```

**Duration:** ~600–800ms total. Fade in (200ms) → brief hold → fade to Home Screen (300ms).

---

### 06 Movie Detail

**Purpose:** Full detail view for a single movie. Primary entry point to playback.

```
Background: full-bleed artwork gradient + dark scrim overlay (see Overlay Patterns)
Back hint: "← Movies", 14px, text-muted, position absolute: x 80px, y 120px

Poster: x 80px, y 160px, 280 × 420px, border-radius 12px, clip
  [Poster art fills frame]
  Film title text (ghost): bottom-left of poster, opacity 0.27, large, bold

Meta Panel: x 420px, y 160px, width 900px, vertical flex, gap 28px
  Title Block (vertical flex, gap 12px):
    Movie title: 60px, Inter 700, text-primary
    Meta row (horizontal flex, gap 20px):
      Year: 17px, text-secondary
      Separator: "·", text-muted
      Runtime: 17px, text-secondary
      Separator: "·"
      Rating badge: padding 4px 10px, border-radius 4px, bg #FFFFFF1A
        Rating text: 13px, Inter 600, text-primary
    Genre tags (horizontal flex, gap 8px):
      Each tag: padding 6px 14px, border-radius 20px, bg #FFFFFF0F, border #FFFFFF1A
        Text: 13px, text-secondary
  Synopsis: 17px, text-secondary, line-height 1.6, max-width 860px (2–3 lines)
  CTA Row (horizontal flex, gap 20px, align-center):
    ▶ Play button (Primary CTA)
    ↩ Resume from X:XX (Secondary CTA) — hidden if no resume position
    Subtitles button (icon + "Subtitles", ghost tertiary)
```

**Focus entry:** Play button (or Resume button if a position exists — Resume is default focused).

---

### 07 TV Show Detail

**Purpose:** Overview of a TV series with season navigation and episode browsing.

```
Background: full-bleed show artwork gradient + dark scrim

Back hint: "← TV Shows", top-left within safe area

Show Poster: x 80px, y 160px, 260 × 390px, border-radius 12px

Meta Panel: x 400px, y 160px, width 900px, vertical flex, gap 24px
  Show title: 56px, Inter 700, text-primary
  Show meta row (horizontal flex, gap 20px):
    "N Seasons": text-secondary
    Separator: "·"
    Year range: text-secondary
    Genre tags (inline)
  Synopsis: 16px, text-secondary, line-height 1.6

Season Tabs (horizontal flex, gap 4px):
  Each tab: padding 12px 28px, border-radius 8px
    Active:   background text-accent (#F5A623), text #08080E, Inter 700
    Inactive: background #FFFFFF12, border #FFFFFF1A, text text-secondary

Episode List (horizontal flex, gap 16px):
  Each episode card: width 240px, vertical flex, gap 10px
    Thumbnail: 240 × 135px (16:9), border-radius 8px
      Ghost episode number: top-left, very low opacity
    Episode title: 14px, Inter 600
      Focused: text-accent
      Default: text-primary
```

**Focus flow:**
1. Entry → first Season tab focused
2. Left/Right → change season
3. Down → enter episode list
4. Left/Right → move between episodes
5. Select → Episode Detail (or directly to Player for simple cases)

---

### 08 Episode Detail

**Purpose:** Full detail for a single episode. Entry point to playback.

```
Background: episode still / show backdrop + bottom-heavy dark scrim

Back hint: "← [Show Title]", top-left

Meta Panel: x 80px, y 180px, width 1000px, vertical flex, gap 16px
  Show name: 18px, text-muted (subdued context)
  Episode title: 56px, Inter 700, text-primary
  Episode meta row:
    "S2 · E4": 17px, text-accent (amber)
    Separator: "·"
    Runtime: 17px, text-secondary
  Episode synopsis: 16px, text-secondary, line-height 1.6

CTA Row (horizontal flex, gap 20px, align-center):
  ▶ Play (Primary CTA)
  ↩ Resume from X:XX (Secondary CTA)
  Prev / Next episode buttons (ghost, icon + label, horizontal flex)

"Up Next" panel (bottom-right area, ~x 1320px, y 500px):
  "UP NEXT" label: 13px, text-muted, letter-spacing 2px
  Preview card (horizontal flex, gap 16px):
    Next episode thumbnail: 180 × 100px, border-radius 8px
    Meta block:
      Episode label: 13px, text-accent
      Episode title: 16px, Inter 600, text-primary
```

---

### 09a Player — Immersive

**Purpose:** Full-screen playback with no UI chrome. The video is the only thing visible.

```
Background: video content fills 1920 × 1080 entirely
Cursor: hidden
All OpenHearth UI: not rendered

Paused indicator (optional, very subtle):
  Dim overlay: rgba(0,0,0,0.3) full screen
  Pause icon: large (96px), opacity 0.12, centered
```

**Any keypress** triggers OSD to appear (transition to 09b state).

**Buffering indicator:** Small spinner, centered, white, low opacity. No text.

---

### 09b Player — OSD Active

**Purpose:** Player with on-screen controls visible. Auto-hides after ~3–5 seconds of no input.

```
Background: same video content as 09a

OSD Top gradient: 0→180px, #000000CC to transparent (top edge)
OSD Bottom gradient: 780–1080px (300px), transparent to #000000F0 (bottom edge)

Top Bar: x 80px, y 40px, width 1760px, horizontal flex, space-between, align-center
  Left — Now Playing:
    Show/series line: 16px, text-secondary ("Severance · S1 E1")
    Episode/movie title: 20px, Inter 600, text-primary
  Right — Subtitle Selector:
    Button: horizontal flex, gap 10px, padding 12px 20px, border-radius 8px
            bg #FFFFFF18, border #FFFFFF30
      CC icon: 18px, text-primary
      Track label: 15px, text-primary ("English")
      Chevron-down icon: 16px, text-secondary

Bottom Bar: x 80px, y 880px, width 1760px, vertical flex, gap 20px
  Progress Section (vertical flex, gap 10px):
    Progress bar + playhead (see Progress/Scrub Bar component)
    Time row (current time left, total time right)
  Controls Row (horizontal flex, gap 32px, centered):
    Skip Back: icon rotate-ccw + "10" label, ghost pill
    Play/Pause: 72 × 72px circle, bg accent-amber, ⏸ icon 28px #08080E
                box-shadow: 0 0 24px #F5A62355 — DEFAULT FOCUSED ELEMENT
    Skip Forward: "30" label + icon rotate-cw, ghost pill
    Stop: square icon + "Stop" label, ghost pill
```

**Focus default:** Play/Pause button (amber circle).
**Auto-hide:** OSD fades out after 3–5 seconds. Any directional key or select re-shows it.

---

### 10 Resume Prompt

**Purpose:** Modal dialog when opening an item with a saved playback position.

```
Backdrop: full screen rgba(0,0,0,0.667) + backdrop-filter: blur(16px)

Modal Card (centered, 600 × auto px):
  [See Modal Card component spec]
  Content (vertical flex, gap 32px):
    "CONTINUE WATCHING?" label: 14px, text-muted, letter-spacing 2px
    Item title: 32px, Inter 700, text-primary (wraps at 472px)
    Progress Preview:
      Mini scrub bar (see Mini progress bar spec)
      Time row: "1:22:14" (text-accent) — total (text-muted)
    Button Column (vertical flex, gap 14px):
      ▶ Resume from X:XX (Primary CTA, full width)
        DEFAULT FOCUSED
      Start from Beginning (Secondary CTA, full width)
```

**Dismiss:** Back key closes without resuming; returns to Item Detail.

---

### 11 Library Empty State

**Purpose:** Gracefully communicates that no media was found in a configured library path.

**Inline row variant** (shown on Home Screen when a row returns 0 items):
```
Row header: as normal ("MOVIES")
Empty placeholder (full row width, horizontal flex, gap 20px, padding 32px 40px):
  border-radius 12px, bg #FFFFFF05, border 1px solid #FFFFFF0F
  Icon: 32px lucide folder-open (movies) or tv (shows), text-muted
  Text block (vertical flex, gap 6px):
    Title: 18px, Inter 600, text-secondary ("No movies found")
    Hint:  14px, text-muted ("Check your library path in config · openhearth.yaml → library.sources")
```

---

### 12 No-Metadata Tile

**Purpose:** How library tiles render when no poster art is available from the metadata provider.

```
Poster area: 140 × 210px (standard tile size), border-radius 8px
             background: dark gradient in brand palette (deep purples/blues/teals)
             border: 1px solid #FFFFFF14

  Icon zone (center of poster, upper 2/3):
    Media type icon: 40px, color #FFFFFF22 (ghost)
      film icon for movies, tv icon for episodes

  Text zone (lower portion, padding 10px 12px):
    Derived title: 12px, Inter 600, text-primary — from filename, truncated
    Derived year: 11px, text-muted — from filename if parseable

Focused state: border 3px solid #F5A623, box-shadow 0 0 20px #F5A62355
               title color → text-accent
```

These tiles must appear visually harmonious alongside fully-enriched poster tiles. The gradient backgrounds use the same dark palette as normal tile placeholders.

---

### 13 Search Screen

**Purpose:** Text search over the local library.

```
Background: bg-primary

Header: [same as Home Screen header]
Back hint: "← Back", header right side (replaces settings/clock group)

Search Scope label: "LOCAL LIBRARY", 12px, text-muted, letter-spacing 2px

Search Input Row:
  [See Text Input component spec]
  Always focused when entering this screen.

Results Area (vertical flex, gap 0px):
  Each result row (horizontal flex, gap 24px, padding 20px 24px):
    Focused row: bg #FFFFFF0A, border 2px solid #F5A623, border-radius 12px
    Default row: bg transparent
    Thumbnail: 80 × 120px (portrait), border-radius 6px
    Meta block (vertical flex, gap 8px, height 120px, justify-center):
      Title: 22px, Inter 600 — text-primary (focused) / text-secondary (default)
      Details: 15px, text-muted ("2017 · Movie · 2h 44m")
    Play hint (focused row only): amber pill, "▶ Open", 15px, Inter 600, #08080E
```

**Empty query state:** No results shown; cursor blinks in input field. Optional: "Search your library" placeholder text (text-muted).

**No results state:** Replace results area with centered message:
```
Icon: lucide search, 32px, text-muted
Title: "No results for '[query]'", 20px, text-secondary
Hint: "Try a shorter title or check your library scan", 14px, text-muted
```

---

### 14 Error / Server Unreachable

**Purpose:** Full-screen fallback when the React app cannot reach the server.

```
Background: bg-primary + radial vignette (center transparent, edges very dark)

Logo area (dimmed — opacity 0.4 on logo mark):
  Logo mark: 60 × 60px, border-radius 15px, amber-ember gradient
  Wordmark: "OPENHEARTH", 28px, Inter 300, text-muted, letter-spacing 8px

Error content (vertical flex, gap 20px, centered):
  Error icon frame: 80 × 80px circle, bg #2A100A
    wifi-off icon: 36px, color error (#E04C2A)
  Error title: "Can't connect to OpenHearth", 40px, Inter 700, text-primary
  Error subtitle: "Make sure the Docker container is running", 18px, text-secondary
  Hint box (horizontal flex, gap 16px, padding 20px 32px, border-radius 10px):
    bg #FFFFFF06, border #FFFFFF10
    Terminal icon: 18px, text-muted
    "docker-compose up  ·  then wait a moment": 15px, text-muted

Retry row (horizontal flex, gap 24px, align-center):
  Retry button (Secondary CTA style):
    refresh-cw icon: 20px
    "Retry" label: 18px
  Countdown block (vertical flex, gap 4px, align-center):
    "RETRYING IN": 13px, text-muted, letter-spacing default
    Countdown number: 28px, Inter 700, text-accent (counts 5→0)
```

**States:**
- `server-unreachable` — initial connection failed on load
- `lost-connection` — was connected, then server stopped responding (same UI)
- `retrying` — swap number for "..." or spinning indicator during the actual retry attempt

---

### 15 Settings

**Purpose:** Configuration overview, accessible from the Home Screen header.

**Entry:** Settings button (top-right header) → directional navigate into the screen.

```
Background: bg-primary + subtle radial glow from top-left

Header: [same structure as Home Screen header]
  Right side: "SETTINGS" label (text-muted, letter-spacing 2px) + "← Home" back hint

Two-column layout (starts below header at y ≈ 112px, height 968px):

LEFT SIDEBAR (x 0, width 320px, height 968px):
  background: bg-elevated (#181826, slightly different from main bg)
  padding: 24px
  vertical flex, gap 4px
  [Settings Nav Items — see component spec]
  Categories: Library, Services, Playback, Metadata, Controls, Display
  Divider: 1px separator line
  Help & Docs item (bottom)

RIGHT CONTENT PANEL (x 320px, width 1600px, height 968px):
  padding: 40px 64px
  vertical flex, gap 28–32px

  Panel Title: 28px, Inter 700, text-primary ("Library")
  Panel Subtitle: 15px, text-muted ("Configure where OpenHearth scans for your media files")
  Divider: 1px separator

  [LIBRARY PANEL — default active]
  Section: "LIBRARY SOURCES" (section label style)
  Source Cards: [see Settings Source Card component]
  Add Source button: ghost, lucide plus icon, "Add library source"

  Section: "SCAN SETTINGS" (section label style)
  Settings rows (horizontal flex, space-between, padding 18px 0):
    "Scan on startup" / Toggle (ON)
    "Watch for changes" / Toggle (ON)
    "Rescan interval" / Value text ("Every 30 min")
  Row separators: 1px, color separator, full width

  "Scan library now" button (ghost CTA, refresh-cw icon)
```

**Other panels (not fully detailed in v1 designs — spec these when implementing):**
- **Services:** Editable list of service tiles with drag-to-reorder affordance
- **Playback:** Transcode quality (Auto/720p/1080p), preferred subtitle language
- **Metadata:** Provider name, API key status (masked `••••••XXXX`), last-synced timestamp
- **Controls:** Read-only table of all key bindings (action → key)
- **Display:** Theme (dark only in v1), overscan adjustment slider

---

## 13. Navigation Model

### Focus Ring Flow — Home Screen

```
[Header: Logo] [Header: Search Icon] [Header: Settings Btn] [Header: Clock]
        ↕ (Up from row 1 / Down from header)
[Streaming Services: Netflix] [YouTube] [Max] [Disney+] → ...
        ↕
[Movies: Tile 1] [Tile 2] [Tile 3] → ...
        ↕
[TV Shows: Tile 1] [Tile 2] [Tile 3] → ...
```

### Reserved Keys
| Key (default) | Action | Overridable |
|---|---|---|
| `ArrowUp/Down/Left/Right` | Navigate | Yes (YAML keybindings) |
| `Enter` | Select | Yes |
| `Backspace` / `Escape` | Back | Yes |
| `Home` | Return to OpenHearth | **No — always intercepted** |
| `Space` | Play/Pause | Yes |

### Home/Back Guarantee
The `Home` key is **intercepted by the kiosk display client** before it reaches any launched commercial service. This must be implemented at the browser/kiosk level, not inside the React app.

---

## 14. Motion & Transitions

All animations should feel deliberate and quick — TV UIs must feel responsive, not sluggish.

| Transition | Duration | Easing | Notes |
|---|---|---|---|
| Screen enter/exit | 250–300 ms | `ease-out` | Fade in/out (opacity 0→1) |
| Focus ring move | 150 ms | `ease-out` | Move ring to new target |
| Service tile launch expand | 300 ms | `ease-out` | Scale up + fade to dark |
| Return-to-home | 600–800 ms total | `ease-in-out` | Warm flash → logo fade-in → Home Screen |
| OSD show/hide | 200 ms | `ease-out` | Opacity fade |
| OSD auto-hide | 3000–5000 ms idle | — | Fade out over 300ms |
| Toggle switch knob | 150 ms | `ease-out` | Left position transition |
| Loader bar fill | Indeterminate loop | linear | 1.5s cycle, repeat |
| Modal backdrop | 200 ms | `ease-out` | Blur + opacity |
| Cursor blink (search) | 1s step-end | — | Standard text cursor blink |

### Tile focus scale
When focus moves to a Library Tile, the tile subtly scales from its default size to its focused size:
```
Default:  140 × 210px
Focused:  148 × 220px (+8/+10px)
Duration: 150ms ease-out
```
This is achieved by CSS scale transform, not layout change, to avoid reflowing sibling tiles.

---

## 15. Degraded States

The interface must remain usable under partial failure. Never show a blank or broken screen.

| Failure condition | Fallback |
|---|---|
| No metadata provider configured | Show No-Metadata Tiles with filename-derived info |
| Poster image fails to load | Replace with No-Metadata Tile gradient + icon |
| Library path empty or missing | Inline empty-state placeholder row |
| Config YAML invalid | Error banner at bottom of screen; fall back to last-good config |
| Server unreachable on load | Full-screen Error / Server Unreachable screen (Screen 14) |
| Server connection lost mid-session | Error screen overlaid; retry countdown auto-starts |
| Transcode fails | Show error in player OSD; offer "Stop" as escape |
| Metadata API key missing / invalid | Tiles degrade gracefully; no API calls made |

---

*This document reflects the v1.0 design in [`designs/designs_1.pen`](designs_1.pen). When screens diverge during implementation, update this document to match — treat it as a living reference, not a frozen spec.*
