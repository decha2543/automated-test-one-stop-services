@echo off
REM ============================================================================
REM AutoQA Hub - stop the background service (Windows).
REM Delegates to hub\bin\hub-service.mjs, which stops the daemonless instance
REM (or the OS supervisor when one is registered) and frees the port.
REM ============================================================================
setlocal ENABLEEXTENSIONS
set "HUB_DIR=%~dp0.."

echo Stopping AutoQA Hub...
call node "%HUB_DIR%\bin\hub-service.mjs" stop
echo AutoQA Hub stopped.
timeout /t 1 /nobreak >nul
exit
