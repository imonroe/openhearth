#!/usr/bin/env bash
#
# OpenHearth kiosk launcher (Linux / Chromium). Brings up Chromium fullscreen,
# chrome-less, pointed at the OpenHearth server, with the Home-guard extension
# loaded so the Home/Back guarantee (FR-A3 / NFR-5) holds on launched services.
#
# Override anything via the environment, e.g.:
#   OPENHEARTH_URL=http://localhost:8080 ./openhearth-kiosk.sh
#
# See docs/deployment/linux-kiosk.md for autostart (systemd user service /
# desktop autostart) and cursor-hiding setup.
set -euo pipefail

# Where the server is. If you enabled server.auth.token, append ?token=YOURTOKEN
# here — but note the bundled UI doesn't yet thread the token through media
# requests, so for a single-box kiosk prefer binding the server to 127.0.0.1
# instead (see docs/config-reference.md § Security).
#
# IMPORTANT: if you change this away from http://localhost:8080, you MUST also set
# `homeUrl` in home-guard/config.js to the same origin — otherwise the Home/Back
# guarantee breaks (the guard would treat the OpenHearth page itself as a service
# and try to "return" to the wrong origin). See home-guard/README.md step 1.
OPENHEARTH_URL="${OPENHEARTH_URL:-http://localhost:8080}"

# A dedicated profile keeps the kiosk's extension + settings isolated and
# persistent across reboots.
PROFILE_DIR="${OPENHEARTH_PROFILE_DIR:-$HOME/.config/openhearth-kiosk}"

# The Home-guard extension directory (this repo's scripts/kiosk/home-guard).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOME_GUARD_DIR="${OPENHEARTH_HOME_GUARD_DIR:-$SCRIPT_DIR/home-guard}"

# Find a Chromium-family browser (override with CHROMIUM_BIN). Prefer Chromium:
# branded Google Chrome 137+ silently ignores --load-extension (a security
# hardening), which would stop the Home-guard from loading. Chromium and Chrome
# For Testing still honour the flag; we also pass a best-effort re-enable feature
# below for branded builds while that toggle still exists.
CHROMIUM_BIN="${CHROMIUM_BIN:-}"
if [[ -z "$CHROMIUM_BIN" ]]; then
  for candidate in chromium chromium-browser google-chrome google-chrome-stable; do
    if command -v "$candidate" >/dev/null 2>&1; then
      CHROMIUM_BIN="$candidate"
      break
    fi
  done
fi
if [[ -z "$CHROMIUM_BIN" ]]; then
  echo "openhearth-kiosk: no Chromium/Chrome binary found (set CHROMIUM_BIN)" >&2
  exit 1
fi

mkdir -p "$PROFILE_DIR"

# Hide the mouse pointer when idle, if `unclutter` is installed (optional). Kill a
# previous instance first so a restart (systemd Restart=always) doesn't pile them up.
if command -v unclutter >/dev/null 2>&1; then
  pkill -x unclutter >/dev/null 2>&1 || true
  unclutter -idle 0.5 -root &
fi

exec "$CHROMIUM_BIN" \
  --kiosk \
  --app="$OPENHEARTH_URL" \
  --user-data-dir="$PROFILE_DIR" \
  --load-extension="$HOME_GUARD_DIR" \
  --autoplay-policy=no-user-gesture-required \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --no-default-browser-check \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI,DisableLoadExtensionCommandLineSwitch \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --password-store=basic \
  --check-for-update-interval=31536000
