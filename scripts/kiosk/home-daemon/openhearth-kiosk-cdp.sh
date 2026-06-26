#!/usr/bin/env bash
#
# OpenHearth kiosk launcher — CDP / Approach B (ADR 0001), PROTOTYPE.
#
# Brings up BRANDED Google Chrome (so Widevine/DRM works) fullscreen at the
# OpenHearth server, with the DevTools endpoint enabled so the Home Daemon can
# navigate the browser back to OpenHearth from any launched service — including
# adversarial ones (Sling) that defeat the in-page extension. Then starts the
# daemon.
#
# Unlike openhearth-kiosk.sh, this does NOT rely on --load-extension: the
# Home/Back guarantee is enforced by the daemon at the OS input layer, not by a
# content script the page can outrun. (You may still load the home-guard extension
# by hand as defense-in-depth.)
#
# See README.md for the input-device + permissions setup. Override via env.
set -euo pipefail

OPENHEARTH_URL="${OPENHEARTH_URL:-http://localhost:8080}"
PROFILE_DIR="${OPENHEARTH_PROFILE_DIR:-$HOME/.config/openhearth-kiosk}"
CDP_HOST="${OPENHEARTH_CDP_HOST:-127.0.0.1}"
CDP_PORT="${OPENHEARTH_CDP_PORT:-9222}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Branded Chrome is required for Widevine/DRM. Override with CHROMIUM_BIN.
CHROMIUM_BIN="${CHROMIUM_BIN:-}"
if [[ -z "$CHROMIUM_BIN" ]]; then
  for candidate in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then
      CHROMIUM_BIN="$candidate"
      break
    fi
  done
fi
if [[ -z "$CHROMIUM_BIN" ]]; then
  echo "openhearth-kiosk-cdp: no Chrome/Chromium binary found (set CHROMIUM_BIN)" >&2
  exit 1
fi

mkdir -p "$PROFILE_DIR"

# Chrome binds --remote-debugging-port to 127.0.0.1 by default (not the LAN). Keep
# it that way: the DevTools endpoint is an unauthenticated local control surface.
"$CHROMIUM_BIN" \
  --kiosk \
  --app="$OPENHEARTH_URL" \
  --user-data-dir="$PROFILE_DIR" \
  --remote-debugging-port="$CDP_PORT" \
  --remote-debugging-address="$CDP_HOST" \
  --autoplay-policy=no-user-gesture-required \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --no-default-browser-check \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --password-store=basic \
  --check-for-update-interval=31536000 &
CHROME_PID=$!

# Stop the daemon if Chrome exits, and vice-versa.
trap 'kill "$CHROME_PID" 2>/dev/null || true' EXIT

OPENHEARTH_HOME_URL="${OPENHEARTH_URL%/}/" \
OPENHEARTH_CDP_HOST="$CDP_HOST" \
OPENHEARTH_CDP_PORT="$CDP_PORT" \
  exec node "$SCRIPT_DIR/home-daemon.mjs"
