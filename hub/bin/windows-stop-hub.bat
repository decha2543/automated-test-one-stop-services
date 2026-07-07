@echo off
REM ============================================================================
REM AutoQA Hub - stop the background service (Windows).
REM Delegates to hub\bin\hub-service.mjs, which stops both PM2-managed and
REM daemonless instances and frees the port.
REM ============================================================================
setlocal ENABLEEXTENSIONS
set "HUB_DIR=%~dp0.."

echo Stopping AutoQA Hub...
call node "%HUB_DIR%\bin\hub-service.mjs" stop
echo AutoQA Hub stopped.
timeout /t 1 /nobreak >nul
exit
