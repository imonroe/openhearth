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

# By default, Chromium uses your normal profile — the extension you installed
# by hand (per the DRM instructions) lives there and Home/Back just works. If
# you prefer a dedicated, isolated kiosk profile (useful when the kiosk account
# is also your daily-driver account), uncomment the PROFILE_DIR line and add
# --user-data-dir="$PROFILE_DIR" to the exec command below. If you do, you MUST
# install the Home-guard extension into THAT profile first: launch Chromium once
# with --user-data-dir="$PROFILE_DIR", open chrome://extensions, enable Developer
# mode, Load unpacked → the home-guard folder.
# PROFILE_DIR="${OPENHEARTH_PROFILE_DIR:-$HOME/.config/openhearth-kiosk}"
# mkdir -p "$PROFILE_DIR"

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

# Hide the mouse pointer when idle, if `unclutter` is installed (optional). Kill a
# previous instance first so a restart (systemd Restart=always) doesn't pile them up.
if command -v unclutter >/dev/null 2>&1; then
  pkill -x unclutter >/dev/null 2>&1 || true
  unclutter -idle 0.5 -root &
fi

# When no dedicated profile is set, launching while the selected browser is
# already running will hand off to the existing process — and kiosk/app/extension
# flags won't apply. Detect that and bail with a clear message.
#
# Map the launcher wrapper name to the real process name: branded Chrome
# launchers (google-chrome, google-chrome-stable) run a process called "chrome",
# while Chromium runs as "chromium" or "chromium-browser".
if [[ -z "${PROFILE_DIR:-}" ]]; then
  _browser_basename="$(basename "$CHROMIUM_BIN")"
  case "$_browser_basename" in
    google-chrome|google-chrome-stable) _check_proc="chrome" ;;
    chromium|chromium-browser)          _check_proc="chromium chromium-browser" ;;
    *)                                  _check_proc="$_browser_basename" ;;
  esac
  for _p in $_check_proc; do
    if pgrep -x -u "$(id -u)" "$_p" >/dev/null 2>&1; then
      echo "openhearth-kiosk: $_p is already running with the default profile." >&2
      echo "  Kiosk flags (--kiosk, --app, --load-extension) won't apply." >&2
      echo "  Close all $_p windows first, or enable the dedicated" >&2
      echo "  PROFILE_DIR option in this script for an isolated profile." >&2
      exit 1
    fi
  done
fi

exec "$CHROMIUM_BIN" \
  --kiosk \
  --app="$OPENHEARTH_URL" \
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
