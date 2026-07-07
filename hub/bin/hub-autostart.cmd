@echo off
REM ===========================================================================
REM hub-autostart.cmd - AutoQA Hub logon auto-start action (Windows)
REM ===========================================================================
REM Registered as the action of the user-scope logon Scheduled Task "AutoQA Hub"
REM by `hub-service.mjs enable-boot`. It runs in the bare logon context where the
REM Volta/scoop shims may not be on PATH yet, so it:
REM   1. Prepends the Volta shim + scoop + user-local bin dirs so `node` resolves.
REM   2. Runs the shared launcher `start`, which starts the Hub via PM2 and falls
REM      back to a daemonless background process automatically (no PM2 needed).
REM
REM PM2-independent by design: unlike the old pm2-resurrect action, this works
REM even when PM2 is blocked (EPERM named pipe). User-scope only (schtasks
REM /rl limited) - no admin.
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
