@echo off
REM ============================================================================
REM AutoQA Hub - build, then start as a background service (Windows).
REM
REM Thin wrapper: it builds the Hub and delegates process management to
REM hub\bin\hub-service.mjs, which starts via PM2 and AUTOMATICALLY falls back to
REM a daemonless background process when PM2 is blocked (EPERM named pipe under
REM Node 25 / locked-down Windows). Force a mode with HUB_PROCESS_MANAGER=none|pm2.
REM ============================================================================
setlocal ENABLEEXTENSIONS
set "HUB_DIR=%~dp0.."

echo.
echo  AutoQA Hub - starting...
echo  ============================================

REM Fast start: skip install+build when the Hub is already built. Delete
REM hub\server\dist to force a rebuild (or use the Hub's in-app Update).
if exist "%HUB_DIR%\server\dist\index.js" (
    echo  Using existing build ^(fast start^).
) else (
    call pnpm -C "%HUB_DIR%" install --frozen-lockfile || goto :fail
    call pnpm -C "%HUB_DIR%" run build || goto :fail
)
call node "%HUB_DIR%\bin\hub-service.mjs" start || goto :fail

echo.
echo  AutoQA Hub is running: http://localhost:5174
echo    Stop:   hub\bin\windows-stop-hub.bat
echo    Status: node hub\bin\hub-service.mjs status
echo.
REM Close the window in the double-click case; harmless when run from a shell.
exit

:fail
echo.
echo  ERROR: Hub failed to start. See the messages above.
echo  Diagnose: node "%HUB_DIR%\bin\hub-service.mjs" status
pause
exit /b 1
