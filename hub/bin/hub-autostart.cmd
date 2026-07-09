@echo off
REM ===========================================================================
REM hub-autostart.cmd - AutoQA Hub logon auto-start action (Windows)
REM ===========================================================================
REM Registered as the action of the user-scope logon Scheduled Task "AutoQA Hub"
REM by `hub-service.mjs enable-boot`. It runs in the bare logon context where the
REM Volta/scoop shims may not be on PATH yet, so it:
REM   1. Prepends the Volta shim + scoop + user-local bin dirs so `node` resolves.
REM   2. Runs the shared launcher `start`, which starts the Hub as a daemonless
REM      detached background process.
REM
REM No privileged daemon by design: this works even on locked-down machines
REM (nothing to be blocked). User-scope only (schtasks /rl limited) - no admin.
REM ===========================================================================
setlocal ENABLEEXTENSIONS

REM Put the Volta shim + scoop + user-local bin dirs FIRST so `node` resolves in
REM the bare logon context (same dirs the installer seeds).
set "PATH=%USERPROFILE%\scoop\apps\volta\current\appdata\bin;%USERPROFILE%\scoop\shims;%USERPROFILE%\.local\bin;%PATH%"

where node >nul 2>nul || (
    echo [hub-autostart] node not found on PATH - cannot start the Hub. Check the Volta shim dir "%USERPROFILE%\scoop\apps\volta\current\appdata\bin".
    exit /b 1
)

echo [hub-autostart] Starting the AutoQA Hub...
node "%~dp0hub-service.mjs" start
exit /b %errorlevel%
