@echo off
REM ============================================================================
REM AutoQA Hub - Start as background service via PM2 (production)
REM
REM Requires: Node.js, pnpm, pm2 (npm i -g pm2)
REM Tip: set HUB_HOST=0.0.0.0 in scripts/.env to expose on LAN.
REM
REM This script intentionally references the pm2 app via the ecosystem file
REM (ecosystem.config.cjs) instead of by app name, so renaming the app in
REM one place is enough.
REM ============================================================================

setlocal ENABLEEXTENSIONS

REM Navigate to hub/ directory (parent of hub/bin/).
set "HUB_DIR=%~dp0.."
set "ECOSYSTEM=ecosystem.config.cjs"

REM Pin PM2_HOME so this script's `pm2 start`/`pm2 save` writes the SAME saved
REM dump the auto-start `pm2 resurrect` reads. pm2's default is
REM %USERPROFILE%\.pm2; make it explicit + persist via setx so the auto-start
REM context can't diverge from where the dump was saved.
set "PM2_HOME=%USERPROFILE%\.pm2"
setx PM2_HOME "%USERPROFILE%\.pm2" >nul 2>nul

echo.
echo  AutoQA Hub - Starting production service...
echo  ============================================
echo.

REM Stop any previous instance and free the port.
cd /d "%HUB_DIR%" || exit /b 1
call pm2 delete %ECOSYSTEM% 2>nul
where kill-port >nul 2>&1 && (
    call kill-port 5174 2>nul
)

REM ---------------------------------------------------------------------------
REM Install dependencies. Failing here is fatal - the build below will be
REM cryptic if node_modules is incomplete, so abort early with a clear error.
REM ---------------------------------------------------------------------------
echo  Installing dependencies...
call pnpm install --frozen-lockfile
if errorlevel 1 (
    echo.
    echo  ERROR: pnpm install failed.
    echo  Check your network and that pnpm-lock.yaml matches package.json.
    pause
    exit /b 1
)

REM Build shared (DTOs/types used by both server and client).
echo  Building shared...
cd /d "%HUB_DIR%\shared" || exit /b 1
call pnpm run build
if errorlevel 1 (
    echo  ERROR: Shared build failed!
    pause
    exit /b 1
)

REM Build server.
echo  Building server...
cd /d "%HUB_DIR%\server" || exit /b 1
call pnpm run build
if errorlevel 1 (
    echo  ERROR: Server build failed!
    pause
    exit /b 1
)

REM Build client (bundled into the server's static route).
echo  Building client...
cd /d "%HUB_DIR%\client" || exit /b 1
call pnpm run build
if errorlevel 1 (
    echo  ERROR: Client build failed!
    pause
    exit /b 1
)

REM Start via pm2 - single server process serves both API + static client.
cd /d "%HUB_DIR%" || exit /b 1
call pm2 start %ECOSYSTEM%
if errorlevel 1 (
    echo  ERROR: pm2 start failed.
    pause
    exit /b 1
)
call pm2 save

echo.
echo  AutoQA Hub is running in background via PM2
echo  ============================================
echo  App: http://localhost:5174
echo  (Server serves both API and client on a single port)
echo.
echo  Commands:
echo    pm2 status              - list all pm2 processes
echo    pm2 logs                - tail logs (all apps)
echo    windows-stop-hub.bat    - stop the AutoQA Hub
echo.

REM Close terminal immediately (quiet mode).
exit
