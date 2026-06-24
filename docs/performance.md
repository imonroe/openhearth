# Performance pass (NFR-1..3)

OpenHearth's living-room responsiveness budget (PRD §16):

| NFR | Target | What it covers |
| --- | --- | --- |
| **NFR-1** | Home interactive **~2 s** | Cold load of the home screen to interactive. |
| **NFR-2** | Focus navigation **~100 ms** | A D-pad press to the focus visibly moving. |
| **NFR-3** | Play start **~2 s direct-play / ~5 s transcode** | "Play" to first frame. |

This document records what we measure, the reproducible method for each, the
baselines captured in this repo's environment, and the gaps that require the
reference mini-PC (a manual run — those numbers are hardware-bound).

> **Reference hardware** (for the wall-clock runs): a low-power mini-PC / TV box
> (e.g. an N100-class x86 or a Raspberry Pi 4/5) running the container, with the
> kiosk Chromium on the same host pointed at `localhost:8080`. Record the exact
> device when you fill in the wall-clock rows.

## Recorded baselines (reproducible here)

### Web bundle size (drives NFR-1)

`pnpm --filter @openhearth/web build` (Vite production build). Read the `gzip`
column — that's what's transferred. The SPA is loaded from the **same container
over localhost**, so transfer time is effectively zero and parse/execute of this
much JS is well under the 2 s budget on the reference hardware.

| Asset | Raw | Gzip |
| --- | --- | --- |
| `index.js` | 239 kB | **72 kB** |
| `index.css` | 8.7 kB | 2.2 kB |
| `index.html` | 0.4 kB | 0.3 kB |

A single ~72 kB-gzip chunk (React 18 + the whole app). No code-splitting is
warranted at this size — the entire app is smaller than a typical single
route-chunk elsewhere — so home-interactive is bounded by React mount, not
download. **Regression guard:** if `index.js` gzip approaches ~150 kB, revisit
(lazy-load the player/detail, audit deps).

### Focus-navigation logic (NFR-2)

The keydown → focus-move → re-render path is NFR-2's budget; the only part that
scales with screen size is the pure `move()` decision. The committed benchmark
([`focusEngine.bench.test.ts`](../packages/web/src/focus/focusEngine.bench.test.ts))
times it on a grid far larger than any real screen (200 rows × ~30 tiles):

```
focus move(): ~0.07 µs/move   (pnpm --filter @openhearth/web test focusEngine.bench)
```

That's ~0.00007 ms — roughly **0.0001 % of the 100 ms budget** — so essentially
the entire budget is available for React's render + paint. The engine is pure and
allocation-light; it is not a hotspot.

## Wall-clock measurements (run on the reference hardware)

These are hardware-bound and measured manually on the reference mini-PC; record
the results in the table below.

### NFR-1 — home interactive (~2 s)

1. `docker compose up -d` on the reference host; wait for `health` to report
   `ready: true`.
2. In the kiosk Chromium, open DevTools → **Performance** (or Lighthouse, "Time
   to Interactive"), hard-reload `localhost:8080`, and read TTI. Alternatively
   `performance.getEntriesByType('navigation')[0].domInteractive`.

### NFR-2 — focus latency (~100 ms)

With the home grid populated, DevTools → Performance, record while pressing an
arrow key, and measure keydown → the focus ring repainting on the next tile. The
logic cost is ~0 (above), so this measures React render + paint.

### NFR-3 — play start (~2 s direct / ~5 s transcode)

DevTools → **Network**, press Play, and time from the `/stream` request to the
`<video>` firing `playing`. Test both a browser-direct-playable file (e.g. H.264
MP4 → ~2 s budget) and one that must transcode (e.g. an MKV → ffmpeg `libx264`,
~5 s budget). The two stream paths themselves are exercised every CI run by
`streamIntegration.test.ts` (direct-play + transcode), so this run measures
*start latency* on real hardware, not correctness.

| NFR | Target | Reference device | Measured | Met? |
| --- | --- | --- | --- | --- |
| NFR-1 home interactive | ~2 s | _(fill in)_ | _(fill in)_ | ☐ |
| NFR-2 focus latency | ~100 ms | _(fill in)_ | _(fill in)_ | ☐ |
| NFR-3 direct-play start | ~2 s | _(fill in)_ | _(fill in)_ | ☐ |
| NFR-3 transcode start | ~5 s | _(fill in)_ | _(fill in)_ | ☐ |

## Conclusion

The two budgets measurable here have **large headroom**: the bundle is a single
~72 kB-gzip chunk (download negligible over localhost) and focus-move logic costs
~0.07 µs. No code-level hotspot needs optimizing for v1 at this scale. The
wall-clock home-interactive and play-start figures are hardware-bound and recorded
on the reference mini-PC using the reproducible steps above; any target missed
there is logged in the table with a follow-up rather than silently assumed.
