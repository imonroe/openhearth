@echo off
REM OpenHearth kiosk launcher (Windows / Chrome or Edge).
REM
REM Brings up the browser fullscreen, chrome-less, pointed at the OpenHearth
REM server, with the Home-guard extension loaded so the Home/Back guarantee
REM (FR-A3 / NFR-5) holds on launched services.
REM
REM Place a shortcut to this file in the Startup folder, or run it from a
REM Task Scheduler "at log on" task. See docs\deployment\windows-kiosk.md.
REM
REM Edit the paths below for your machine.

setlocal

REM Server URL. If you enabled server.auth.token, append ?token=YOURTOKEN — but
REM the bundled UI doesn't yet thread the token through media requests, so for a
REM single-box kiosk prefer binding the server to 127.0.0.1 (see
REM docs\config-reference.md, Security section).
REM
REM IMPORTANT: if you change this away from http://localhost:8080, you MUST also
REM set `homeUrl` in home-guard\config.js to the same origin, or the Home/Back
REM guarantee breaks. See home-guard\README.md step 1.
set "OPENHEARTH_URL=http://localhost:8080"

REM Path to the browser. NOTE: branded Google Chrome 137+ (and current Edge)
REM silently IGNORE --load-extension, so the Home-guard never loads and Home/Back
REM stops working from a launched service. Prefer un-branded Chromium or "Chrome
REM For Testing", which still honour the flag. The --disable-features re-enable
REM below is a best-effort fallback for branded builds while that toggle exists;
REM if it stops working, load the extension once via chrome://extensions (Developer
REM mode -> Load unpacked -> the home-guard folder) into your Chrome profile.
REM See docs\deployment\windows-kiosk.md.
set "BROWSER=C:\Program Files\Google\Chrome\Application\chrome.exe"

REM Absolute path to this repo's Home-guard extension folder.
set "HOME_GUARD_DIR=%~dp0home-guard"

REM By default, Chrome uses your normal profile — the extension you installed
REM by hand (per the DRM instructions) lives there and Home/Back just works.
REM If you prefer a dedicated, isolated kiosk profile (useful when the kiosk
REM account is also your daily-driver account), uncomment the PROFILE_DIR line
REM and add --user-data-dir="%PROFILE_DIR%" to the start command below. If you
REM do, you MUST install the Home-guard extension into THAT profile first:
REM launch Chrome once with --user-data-dir="%PROFILE_DIR%", open
REM chrome://extensions, enable Developer mode, Load unpacked → home-guard.
REM set "PROFILE_DIR=%LOCALAPPDATA%\OpenHearthKiosk"

REM When no dedicated profile is set and Chrome/Edge is already running, the kiosk
REM launch will open in the existing session — and --kiosk/--app/--load-extension
REM flags may not apply. Close all browser windows before running this script, or
REM enable the PROFILE_DIR option above for an isolated profile.
REM (When PROFILE_DIR IS set, the dedicated profile avoids the singleton collision,
REM so we skip this check entirely.)
if not defined PROFILE_DIR (
  tasklist /FI "IMAGENAME eq chrome.exe" 2>NUL | find /I "chrome.exe" >NUL
  if not errorlevel 1 goto :browser_running
  tasklist /FI "IMAGENAME eq msedge.exe" 2>NUL | find /I "msedge.exe" >NUL
  if not errorlevel 1 goto :browser_running
)
goto :browser_ok

:browser_running
echo WARNING: Chrome/Edge is already running. Kiosk flags may not apply.
echo Close all browser windows first, or enable the dedicated PROFILE_DIR option.
pause

:browser_ok

start "" "%BROWSER%" ^
  --kiosk ^
  --app=%OPENHEARTH_URL% ^
  --load-extension="%HOME_GUARD_DIR%" ^
  --autoplay-policy=no-user-gesture-required ^
  --noerrdialogs ^
  --disable-infobars ^
  --no-first-run ^
  --no-default-browser-check ^
  --disable-session-crashed-bubble ^
  --disable-features=TranslateUI,DisableLoadExtensionCommandLineSwitch ^
  --check-for-update-interval=31536000

endlocal