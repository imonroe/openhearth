/**
 * Playwright global setup — generate the player E2E media fixture (#38).
 *
 * Creates a short, browser-direct-playable H.264/AAC MP4 under fixtures/media/
 * so the real server can index it and the player spec can stream + play it. If
 * ffmpeg isn't installed (e.g. a dev machine), it's skipped and the player spec
 * skips itself; CI installs ffmpeg so it always runs there.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default function globalSetup(): void {
  const mediaDir = path.join(here, 'fixtures/media');
  const out = path.join(mediaDir, 'sample.mp4');
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
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    '-movflags',
    '+faststart',
    out,
  ]);
  if (r.status !== 0) {
    console.warn('e2e: ffmpeg fixture generation failed:', r.stderr?.toString());
  }
}
