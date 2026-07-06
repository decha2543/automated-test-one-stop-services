@echo off
REM ===========================================================================
REM pm2-resurrect.cmd - AutoQA Hub logon auto-start action
REM ===========================================================================
REM Registered as the action of the user-scope logon Scheduled Task
REM "AutoQA Hub Resurrect" by scripts\setup\setup-windows.bat. It runs in the
REM bare logon context where pm2/node (Volta shims) are NOT yet on PATH, which
REM is exactly why the old HKCU Run-key startup hook failed. So it:
REM
REM 1. Pins PM2_HOME to the SAME dir start/save use (%USERPROFILE%\.pm2),
REM so `pm2 resurrect` reads the dump `pm2 save` wrote.
REM 2. Prepends the Volta shim + scoop dirs ahead of the inherited user
REM PATH so `pm2` and `node` resolve in this context -- the same
REM dirs setup-windows.bat seeds.
REM 3. Runs `pm2 resurrect`; with no saved dump it logs the condition and
REM exits 0 so the logon task never reports a spurious failure (design
REM Error Handling, pm2).
REM
REM User-scope only: registered with `schtasks /rl limited` -- no admin.
REM ===========================================================================
setlocal ENABLEEXTENSIONS

REM 1) Pin PM2_HOME to the same dump dir start/save use.
set "PM2_HOME=%USERPROFILE%\.pm2"

REM 2) Put the Volta shim + scoop dirs FIRST so pm2/node resolve before the
REM inherited user PATH. Same dirs the installer seeds.
set "PATH=%USERPROFILE%\scoop\apps\volta\current\appdata\bin;%USERPROFILE%\scoop\shims;%USERPROFILE%\.local\bin;%PATH%"

REM 3) No saved dump -> nothing to resurrect; log and exit 0 (not an error).
if not exist "%PM2_HOME%\dump.pm2" (
    echo [pm2-resurrect] No saved process list at "%PM2_HOME%\dump.pm2" - nothing to resurrect.
    exit /b 0
)

REM pm2 must resolve in this bare context; if not, log the missing binary.
where pm2 >nul 2>nul || (
    echo [pm2-resurrect] pm2 not found on PATH - cannot resurrect. Check the Volta shim dir "%USERPROFILE%\scoop\apps\volta\current\appdata\bin".
    exit /b 1
)

echo [pm2-resurrect] Resurrecting the saved Hub process from "%PM2_HOME%"...
pm2 resurrect
exit /b %errorlevel%
