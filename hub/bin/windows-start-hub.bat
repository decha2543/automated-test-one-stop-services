@echo off
REM ============================================================================
REM AutoQA Hub - build, then start as a background service (Windows).
REM
REM Thin wrapper: it builds the Hub and delegates process management to
REM hub\bin\hub-service.mjs, which runs the Hub as a daemonless detached
REM background process (optionally supervised by a user-scope logon task when
REM `hub-service.mjs enable-boot` has registered one).
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
