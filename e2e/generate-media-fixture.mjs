/**
 * Generate the player E2E media fixture (#38).
 *
 * Creates a short, browser-direct-playable VP9/Opus WebM under fixtures/media/
 * so the real server can index it and the player spec can stream + play it.
 *
 * WebM (VP9/Opus) — not MP4 (H.264/AAC) — because Playwright's bundled Chromium
 * ships *without* proprietary codecs: an H.264 <video> loads but never decodes, so
 * playback would never advance. VP9/Opus are royalty-free and decode in that
 * Chromium, and the server direct-plays the WebM (served as video/webm with range
 * support) rather than transcoding it — so the spec exercises a real stream.
 *
 * This MUST run before Playwright starts the OpenHearth `webServer`: Playwright
 * launches webServers *before* globalSetup, so if the fixture were generated only
 * in globalSetup the server would scan an empty/absent media dir and index zero
 * items (the library row would never render). The `e2e` npm script therefore runs
 * this as an explicit pre-step. globalSetup also calls it as a belt-and-braces
 * fallback for `playwright test` invocations that bypass the npm script.
 *
 * If ffmpeg isn't installed (e.g. a dev machine) the fixture is skipped and the
 * player spec skips itself; CI installs ffmpeg so it always runs there.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export function generateMediaFixture() {
  const mediaDir = path.join(here, 'fixtures/media');
  const out = path.join(mediaDir, 'sample.webm');
  if (fs.existsSync(out)) return;
  if (spawnSync('ffmpeg', ['-version']).status !== 0) {
    console.warn('e2e: ffmpeg not found — player media fixture skipped (player spec will skip)');
    return;
  }
  fs.mkdirSync(mediaDir, { recursive: true });
  const r = spawnSync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=320x240:rate=15:d=30',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=30',
    // VP9 + Opus, fast realtime encode (libvpx-vp9 is otherwise slow in CI).
    '-c:v',
    'libvpx-vp9',
    '-pix_fmt',
    'yuv420p',
    '-deadline',
    'realtime',
    '-cpu-used',
    '8',
    '-row-mt',
    '1',
    '-b:v',
    '500k',
    '-c:a',
    'libopus',
    '-shortest',
    out,
  ]);
  if (r.status !== 0) {
    console.warn('e2e: ffmpeg fixture generation failed:', r.stderr?.toString());
  } else {
    console.log(`e2e: generated player media fixture (VP9/Opus WebM) at ${out}`);
  }
}

// Run directly (node e2e/generate-media-fixture.mjs).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateMediaFixture();
}
