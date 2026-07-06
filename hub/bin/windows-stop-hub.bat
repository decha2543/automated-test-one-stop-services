@echo off
REM ============================================================================
REM AutoQA Hub - Stop background PM2 service.
REM
REM Uses the ecosystem file rather than the pm2 app name so renaming the
REM app only requires editing hub/ecosystem.config.cjs.
REM ============================================================================

setlocal ENABLEEXTENSIONS

set "HUB_DIR=%~dp0.."
set "ECOSYSTEM=ecosystem.config.cjs"

REM Pin PM2_HOME to the SAME dir start/save/resurrect use so `pm2 stop`/
REM `pm2 delete` target the right daemon. pm2's default is
REM %USERPROFILE%\.pm2.
set "PM2_HOME=%USERPROFILE%\.pm2"

echo Stopping AutoQA Hub...
cd /d "%HUB_DIR%" 2>nul

call pm2 stop %ECOSYSTEM% 2>nul
call pm2 delete %ECOSYSTEM% 2>nul

REM Free the API/UI port in case anything else grabbed it.
where kill-port >nul 2>&1 && (
    call kill-port 5174 2>nul
)

echo AutoQA Hub stopped.
timeout /t 2 /nobreak >nul
exit
