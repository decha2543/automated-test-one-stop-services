@echo off
setlocal ENABLEEXTENSIONS
chcp 65001 >nul
REM ===========================================================================
REM   ONE-CLICK UNINSTALLER (Windows) — removes the install AND the workspace
REM ===========================================================================
REM   Double-click it. All logic lives in scripts/setup/uninstall.mjs (--purge);
REM   this file only hands over, so "what gets removed" has ONE implementation
REM   shared by every OS and every entry point.
REM
REM   Why it opens a second window instead of running node here: cmd keeps the
REM   running batch file open, and this .bat lives INSIDE the folder being
REM   deleted. So it starts node from %TEMP% in its own window and exits
REM   immediately — that closes the handle on this file before node gets to the
REM   delete step. The new window stays open (cmd /k) so the result is readable.
REM
REM   Consequence: this launcher cannot report the outcome (exit code and output
REM   belong to the other window). Scripted or CI removal should call the CLI
REM   directly, where both are available:
REM       node scripts\setup\uninstall.mjs --purge --run --yes
REM
REM   Safety is enforced by uninstall.mjs, not here: it refuses to delete the
REM   folder while a test project, a brain project folder, or uncommitted /
REM   unpushed git work is still in it, it asks for the folder name to be typed,
REM   and it stops the Hub then verifies the port is free before deleting
REM   anything. Prerequisite: node on PATH (setup installed it).
REM
REM   Plain uninstall, keeping the folder:  task uninstall -- --run
REM ===========================================================================
pushd "%~dp0..\.." || goto :fail
set "ROOT=%CD%"
popd

if not exist "%ROOT%\scripts\setup\uninstall.mjs" goto :fail
where node >nul 2>&1 || goto :nonode

echo.
echo  ===================================================
echo    UNINSTALL + DELETE WORKSPACE
echo    %ROOT%
echo  ===================================================
echo   Continuing in a new window - this one closes so the
echo   folder is not in use. Read the new window for the result.
echo.

cd /d "%TEMP%" || goto :fail
start "Uninstall - Automated Test One-Stop Service" cmd /k node "%ROOT%\scripts\setup\uninstall.mjs" --purge --run
exit /b 0

:nonode
echo.
echo  ERROR: node is not on PATH - cannot run the uninstaller.
pause
exit /b 1

:fail
echo.
echo  ERROR: could not locate the workspace from "%~dp0".
pause
exit /b 1
