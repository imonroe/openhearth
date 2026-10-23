#!/usr/bin/env node
//
// OpenHearth Home Daemon — PROTOTYPE (ADR 0001, Approach B).
//
// The durable fix for the kiosk Home/Back guarantee (FR-A3 / NFR-5). Instead of a
// browser extension intercepting the Home key *inside* the service page — which an
// adversarial player like Sling can defeat by hijacking keydown before the page's
// own JS, or by remapping the key for its own controls — this daemon grabs the
// reserved keys at the OS input layer (Linux evdev) and drives the browser over
// the Chrome DevTools Protocol (CDP) to navigate back to OpenHearth. Because the
// key is caught before any page JavaScript runs, no web app can prevent the
// return. And because the browser is branded Chrome (with Widevine), DRM services
// still play — solving both problems at once.
//
// SCOPE (prototype): Linux evdev key-grab + CDP navigate-home only. Per-service
// user-agent (Network.setUserAgentOverride) and Windows key capture are designed
// in the ADR but not implemented here yet — see README "Not yet implemented".
//
// Requires Node >= 22 for the built-in WebSocket + fetch globals (no npm install).
// Run with: node home-daemon.mjs   (see README for the device + CDP setup).

import { createReadStream } from 'node:fs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────
// Defaults, overridable by config.json next to this file, then by env vars.
const DEFAULTS = {
  // Where OpenHearth is served — the daemon navigates the browser here on Home.
  homeUrl: 'http://localhost:8080/',
  // Chrome's DevTools endpoint (start Chrome with --remote-debugging-port=9222,
  // bound to 127.0.0.1; see the launch script).
  cdpHost: '127.0.0.1',
  cdpPort: 9222,
  // The Linux input device to grab. Find yours under /dev/input/by-id/ (stable
  // across reboots) or /dev/input/eventN; the user must have read access (input
  // group). See README for discovery.
  device: '/dev/input/by-id/REPLACE-WITH-YOUR-KEYBOARD-OR-REMOTE-kbd',
  // evdev key codes that return to OpenHearth. Defaults: KEY_HOME (102),
  // KEY_BACK (158), KEY_HOMEPAGE (172). Use debug mode to discover your remote's.
  returnKeyCodes: [102, 158, 172],
  // Log every key code seen, so you can discover what your remote emits.
  debug: false,
};

function loadConfig() {
  let fileCfg = {};
  try {
    fileCfg = JSON.parse(readFileSync(path.join(here, 'config.json'), 'utf8'));
  } catch {
    // No config.json (or unreadable) — defaults + env only.
  }
  const cfg = { ...DEFAULTS, ...fileCfg };
  if (process.env.OPENHEARTH_HOME_URL) cfg.homeUrl = process.env.OPENHEARTH_HOME_URL;
  if (process.env.OPENHEARTH_CDP_HOST) cfg.cdpHost = process.env.OPENHEARTH_CDP_HOST;
  if (process.env.OPENHEARTH_CDP_PORT) cfg.cdpPort = Number(process.env.OPENHEARTH_CDP_PORT);
  if (process.env.OPENHEARTH_INPUT_DEVICE) cfg.device = process.env.OPENHEARTH_INPUT_DEVICE;
  if (process.env.OPENHEARTH_DEBUG) cfg.debug = process.env.OPENHEARTH_DEBUG === 'true';
  return cfg;
}

const cfg = loadConfig();
const RETURN_CODES = new Set(cfg.returnKeyCodes);
const CDP_BASE = `http://${cfg.cdpHost}:${cfg.cdpPort}`;

function log(msg) {
  console.log(`[openhearth-home-daemon] ${msg}`);
}

if (typeof WebSocket === 'undefined') {
  log('FATAL: global WebSocket is unavailable — run on Node >= 22 (or pass');
  log('       --experimental-websocket on Node 20/21). Exiting.');
  process.exit(1);
}

// ── CDP: navigate the active tab back to OpenHearth ───────────────────────────
// Per press we (re)discover the page target via the HTTP /json endpoint and open
// a short-lived WebSocket to send Page.navigate. Re-discovering each time keeps us
// robust to the tab navigating between services and to Chrome restarting, at the
// cost of a few ms — negligible for a human key press.
async function navigateHome() {
  const res = await fetch(`${CDP_BASE}/json`);
  if (!res.ok) throw new Error(`CDP /json HTTP ${res.status}`);
  const targets = await res.json();
  const pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!pageTarget) throw new Error('no CDP page target found');

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('CDP navigate timed out'));
    }, 5000);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url: cfg.homeUrl } }));
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.id === 1) {
        clearTimeout(timer);
        ws.close();
        if (msg.error) reject(new Error(`Page.navigate: ${msg.error.message}`));
        else resolve();
      }
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('CDP WebSocket error (is Chrome started with --remote-debugging-port?)'));
    });
  });
}

let navigating = false;
function onKeyPress(code) {
  if (cfg.debug) {
    log(`key code=${code}${RETURN_CODES.has(code) ? ' (returns to OpenHearth)' : ''}`);
  }
  if (!RETURN_CODES.has(code)) return;
  if (navigating) return; // debounce: ignore repeats while a navigation is in flight
  navigating = true;
  navigateHome()
    .then(() => log(`returned to OpenHearth (${cfg.homeUrl})`))
    .catch((err) => log(`navigate failed: ${err.message}`))
    .finally(() => {
      navigating = false;
    });
}

// ── evdev: grab reserved keys at the OS input layer ───────────────────────────
// Each Linux input_event record is 24 bytes on 64-bit kernels:
//   struct timeval time;  // 16 bytes (two 64-bit longs)
//   __u16 type;           // offset 16
//   __u16 code;           // offset 18
//   __s32 value;          // offset 20  (0=release, 1=press, 2=autorepeat)
// We act on EV_KEY (type 1) presses (value 1).
const EV_KEY = 1;
const RECORD_SIZE = 24;

function watchDevice() {
  log(`opening input device ${cfg.device}`);
  const stream = createReadStream(cfg.device);
  let buf = Buffer.alloc(0);

  stream.on('data', (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (buf.length >= RECORD_SIZE) {
      const type = buf.readUInt16LE(16);
      const code = buf.readUInt16LE(18);
      const value = buf.readInt32LE(20);
      buf = buf.subarray(RECORD_SIZE);
      if (type === EV_KEY && value === 1) onKeyPress(code);
    }
  });

  const retry = (why) => {
    log(`input device ${why}; retrying in 2s`);
    setTimeout(watchDevice, 2000);
  };
  stream.on('error', (err) => retry(`error: ${err.message}`));
  stream.on('close', () => retry('closed'));
}

log(`starting — home=${cfg.homeUrl} cdp=${CDP_BASE} device=${cfg.device}`);
log(`return key codes: ${[...RETURN_CODES].join(', ')}${cfg.debug ? ' (debug on)' : ''}`);
watchDevice();
