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
REM set HOME_URL in home-guard\content.js to the same origin, or the Home/Back
REM guarantee breaks. See home-guard\README.md step 1.
set "OPENHEARTH_URL=http://localhost:8080"

REM Path to Chrome (adjust if installed elsewhere, or point at msedge.exe).
set "BROWSER=C:\Program Files\Google\Chrome\Application\chrome.exe"

REM Dedicated, persistent kiosk profile (keeps the extension + settings).
set "PROFILE_DIR=%LOCALAPPDATA%\OpenHearthKiosk"

REM Absolute path to this repo's Home-guard extension folder.
set "HOME_GUARD_DIR=%~dp0home-guard"

start "" "%BROWSER%" ^
  --kiosk ^
  --app=%OPENHEARTH_URL% ^
  --user-data-dir="%PROFILE_DIR%" ^
  --load-extension="%HOME_GUARD_DIR%" ^
  --autoplay-policy=no-user-gesture-required ^
  --noerrdialogs ^
  --disable-infobars ^
  --no-first-run ^
  --no-default-browser-check ^
  --disable-session-crashed-bubble ^
  --disable-features=TranslateUI ^
  --check-for-update-interval=31536000

endlocal
