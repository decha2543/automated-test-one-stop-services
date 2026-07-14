@echo off
setlocal ENABLEEXTENSIONS ENABLEDELAYEDEXPANSION
chcp 65001 >nul

REM ===========================================================================
REM   ONE-CLICK INSTALLER (Windows)
REM ===========================================================================
REM   Standalone file - distribute this SINGLE .bat. End user double-clicks it
REM   and everything is handled: git clone + toolchain install + deps + Hub start.
REM
REM   Target Directory defaults to the CURRENT directory if the user presses
REM   Enter without typing anything - no input is mandatory.
REM
REM   Prerequisites: Windows 10+ (curl + PowerShell built-in). Nothing else.
REM ===========================================================================

set "REPO_URL=https://github.com/decha2543/automated-test-one-stop-services.git"

echo ===================================================
echo   AUTOMATED TEST ONE-STOP SERVICE - INSTALLER
echo ===================================================
echo   Welcome! This sets everything up for you automatically -
echo   no technical knowledge needed. It installs the test
echo   automation Hub and opens it in your browser when done.
echo.
echo   * It usually takes about 5-15 minutes the first time.
echo   * You'll see technical messages scroll by - that's normal.
echo   * Please just keep this window open until it finishes.
echo ===================================================

REM --------------------------------------------------------------------------
REM Ask for Target Directory (default = current directory)
REM --------------------------------------------------------------------------
echo.
set "TARGET="
set /p "TARGET=Enter Target Directory [default: current dir]: "
if defined TARGET set "TARGET=!TARGET:"=!"

REM Default to current directory if empty/blank
if not defined TARGET set "TARGET=."
set "TARGET_NOSPACE=!TARGET: =!"
if not defined TARGET_NOSPACE set "TARGET=."

REM Resolve to absolute path
for %%I in ("!TARGET!") do set "TARGET_ABS=%%~fI"
echo.
echo   Target: !TARGET_ABS!

REM --------------------------------------------------------------------------
REM Create target directory if needed
REM --------------------------------------------------------------------------
if not exist "!TARGET_ABS!\" (
    mkdir "!TARGET_ABS!" 2>nul
    if errorlevel 1 (
        echo   [error] Cannot create directory: !TARGET_ABS!
        echo   [hint]  Check the path is valid and you have write permission.
        pause
        exit /b 1
    )
)

REM --------------------------------------------------------------------------
REM Ensure git is available (install via winget or scoop if missing)
REM --------------------------------------------------------------------------
where git >nul 2>nul
if errorlevel 1 (
    echo.
    echo   [install] git not found - installing via winget...
    winget install Git.Git --accept-package-agreements --accept-source-agreements >nul 2>nul
    call :refreshPath
    where git >nul 2>nul
    if errorlevel 1 (
        echo   [install] winget failed, trying scoop...
        where scoop >nul 2>nul || (
            powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force; Invoke-RestMethod get.scoop.sh | Invoke-Expression" >nul 2>nul
            call :refreshPath
        )
        call scoop install git >nul 2>nul
        call :refreshPath
    )
    where git >nul 2>nul
    if errorlevel 1 (
        echo.
        echo   [error] Could not install git automatically.
        echo   [hint]  Install git manually from https://git-scm.com then re-run.
        pause
        exit /b 1
    )
    echo   [OK] git installed
)

REM --------------------------------------------------------------------------
REM Clone or update the repository
REM --------------------------------------------------------------------------
set "WORKSPACE=!TARGET_ABS!\automated-test-one-stop-service"

if exist "!WORKSPACE!\.git\" (
    echo.
    echo   [update] Repository already exists - pulling latest...
    git -C "!WORKSPACE!" pull --ff-only
    if errorlevel 1 (
        echo   [warn] git pull failed - continuing with existing code
    )
) else (
    echo.
    echo   [clone] Cloning repository...
    git clone --depth 1 "!REPO_URL!" "!WORKSPACE!"
    if errorlevel 1 (
        echo   [error] git clone failed. Check network/proxy and the URL:
        echo           !REPO_URL!
        pause
        exit /b 1
    )
    echo   [OK] Repository cloned
)

REM --------------------------------------------------------------------------
REM Run the setup bootstrap
REM --------------------------------------------------------------------------
echo.
echo ===================================================
echo   Running setup (toolchain + deps + Hub start)...
echo   The technical messages below are normal - please keep this window open.
echo ===================================================

set "KIRO_SETUP_STATE_DIR=!WORKSPACE!"
set "KIRO_NO_PAUSE=1"
REM Let the installer open the browser once, AFTER the readiness poll below, so
REM setup itself does not open too early. install-shortcut still runs in setup.
set "KIRO_NO_OPEN=1"
call "!WORKSPACE!\scripts\setup\setup-windows.bat"
set "SETUP_RC=!ERRORLEVEL!"

if not "!SETUP_RC!"=="0" (
    echo.
    echo   [error] Setup did not finish ^(code !SETUP_RC!^).
    echo   Don't worry - just run this installer again. It continues
    echo   where it left off; finished steps are skipped.
    echo   If it keeps failing, the messages above show what to fix.
    pause
    exit /b 1
)

REM --------------------------------------------------------------------------
REM Wait for Hub to be ready
REM --------------------------------------------------------------------------
echo.
echo   Waiting for Hub on http://localhost:5174 (up to 60s)...
set "HUB_READY=0"
set /a _poll=0
:poll_loop
set /a _poll+=1
curl.exe -fsS --max-time 3 http://localhost:5174 >nul 2>nul && set "HUB_READY=1"
if "!HUB_READY!"=="1" goto :hub_ok
if !_poll! GEQ 60 goto :hub_fail
ping -n 2 127.0.0.1 >nul 2>nul
goto :poll_loop

:hub_ok
echo.
echo ===================================================
echo   ALL SET! Your Test Hub is ready to use.
echo ===================================================
echo   Open: http://localhost:5174
echo.
echo   Opening it in your browser now...
call node "!WORKSPACE!\hub\bin\hub-service.mjs" open
echo.
echo   Next time, just double-click the "Test Hub" icon on your
echo   desktop to open it again.
echo.
echo   Workspace: !WORKSPACE!
echo ===================================================
echo.
pause
exit /b 0

:hub_fail
echo.
echo   [error] Hub did not start within 60s.
echo   Try running this installer again - it resumes where it left off.
echo   [hint]  Check the Hub status: node hub\bin\hub-service.mjs status ^(logs: hub\.run\hub.log^)
pause
exit /b 1

REM --------------------------------------------------------------------------
:refreshPath
for /f "usebackq tokens=* delims=" %%P in (`powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%P"
goto :eof
