@echo off
setlocal ENABLEEXTENSIONS ENABLEDELAYEDEXPANSION
chcp 65001 >nul

REM ===========================================================================
REM AUTOMATED TEST ENVIRONMENT SETUP (Windows) - Setup_Bootstrap (Area G)
REM ===========================================================================
REM Installs the 5 Core tools from the lowest baseline, installs deps,
REM starts the Hub, then verifies. Idempotent per tool and re-runnable via a
REM state ledger ("<target>\.setup-state.json", same shape as
REM hub/server/src/services/setup-state.ts):
REM
REM { "steps": { "node": "done"|"failed"|"pending", ... }, "updatedAt": "..." }
REM
REM STEP_ORDER (M = 7, progress shown as "name (N/7)"):
REM 1 node 2 pnpm 3 uv 4 task 5 pm2 6 install-deps 7 start-hub
REM
REM Android is decoupled from Core: it is opt-in via `task setup-android`
REM (scripts\setup\windows\set-android-home.ps1) and never installed here.
REM
REM Opt-in env:
REM KIRO_INSECURE_TLS=1 Prefetch Node tarball via curl -k (TLS proxy)
REM KIRO_SETUP_STATE_DIR Where .setup-state.json lives (default: repo root)
REM KIRO_NO_PAUSE=1 Do not pause at the end (used by Release_Launcher)
REM KIRO_DISABLE_SHELL_DECOUPLE=1 Skip exposing Git's bundled GNU tools (find/
REM sed/cp/...) on the user PATH. Decoupling is ON by
REM default now that the Taskfiles use no GNU-only
REM `find`; `task` runs from cmd, PowerShell, and Git
REM Bash out of the box (Layer D, best-effort; NEVER a
REM Core step). See :shellDecouple.
REM ===========================================================================

echo ===================================================
echo   AUTOMATED TEST ENVIRONMENT SETUP (Windows)
echo ===================================================

set "SETUP_ROOT=%~dp0"
cd /d "%SETUP_ROOT%"
set "WORKSPACE_ROOT=%SETUP_ROOT%..\.."
@REM for %%I in ("%SETUP_ROOT%") do set "WORKSPACE_ROOT=%%~fI..\.."

REM --------------------------------------------------------------------------
REM Single source of truth for tool versions: scripts\setup\versions.env, shared
REM with setup-linux.sh. The Volta pin in package.json ("volta".node) is the
REM Node runtime authority; versions.env re-states it for the installer
REM bootstrap. No stale literal fallback -- abort if the file is missing.
REM --------------------------------------------------------------------------
set "VERSIONS_FILE=%SETUP_ROOT%versions.env"
if not exist "%VERSIONS_FILE%" (
    echo   [error] Version source not found: "%VERSIONS_FILE%"
    echo   [hint]  Restore scripts\setup\versions.env ^(KEY=value lines: NODE_VERSION, PYTHON_VERSION^); no stale fallback is used.
    exit /b 1
)
set "NODE_VERSION="
set "PYTHON_VERSION="
for /f "usebackq eol=# tokens=1,* delims==" %%K in ("%VERSIONS_FILE%") do (
    if /I "%%K"=="NODE_VERSION" set "NODE_VERSION=%%L"
    if /I "%%K"=="PYTHON_VERSION" set "PYTHON_VERSION=%%L"
)
if not defined NODE_VERSION (
    echo   [error] NODE_VERSION missing from "%VERSIONS_FILE%"
    echo   [hint]  Add a line NODE_VERSION=^<version^> to scripts\setup\versions.env.
    exit /b 1
)
if not defined PYTHON_VERSION (
    echo   [error] PYTHON_VERSION missing from "%VERSIONS_FILE%"
    echo   [hint]  Add a line PYTHON_VERSION=^<version^> to scripts\setup\versions.env.
    exit /b 1
)

REM --------------------------------------------------------------------------
REM PRIMER: seed PATH with scoop/volta shim dirs. Each install step also calls
REM :refreshPath to pull the latest persisted PATH so the next command can see
REM what was just installed (without opening a new terminal).
REM --------------------------------------------------------------------------
set "SCOOP_SHIMS=%USERPROFILE%\scoop\shims"
set "VOLTA_BIN=%USERPROFILE%\scoop\apps\volta\current\appdata\bin"
set "USER_LOCAL=%USERPROFILE%\.local\bin"
set "PATH=%SCOOP_SHIMS%;%VOLTA_BIN%;%USER_LOCAL%;%PATH%"
set "UV_LINK_MODE=copy"

REM Playwright browsers share one cache across tool workspaces.
set "PLAYWRIGHT_BROWSERS_PATH=%WORKSPACE_ROOT%\.cache\playwright-browsers"
setx PLAYWRIGHT_BROWSERS_PATH "%WORKSPACE_ROOT%\.cache\playwright-browsers" >nul 2>nul

REM --------------------------------------------------------------------------
REM Setup_State ledger location + load. We preserve any step already 'done'
REM from a previous run and (re)write the ledger up front so the
REM total step count (M) is known for progress.
REM --------------------------------------------------------------------------
if not defined KIRO_SETUP_STATE_DIR set "KIRO_SETUP_STATE_DIR=%WORKSPACE_ROOT%"
if not exist "%KIRO_SETUP_STATE_DIR%" mkdir "%KIRO_SETUP_STATE_DIR%"
set "STATE_FILE=%KIRO_SETUP_STATE_DIR%\.setup-state.json"
call :loadState
call :writeState

REM Detect elevation once so privilege-sensitive sub-steps can
REM choose user-scope vs report the required privilege level.
net session >nul 2>nul
if errorlevel 1 ( set "IS_ADMIN=0" ) else ( set "IS_ADMIN=1" )

REM ===========================================================================
REM STEP 1/7 - node
REM ===========================================================================
echo.
echo [step] node (1/7)
where node >nul 2>nul && ( echo   [SKIPPED] node already present on PATH ^(strict skip^) & call :done ST_node & goto :step_pnpm )
call :installNode
if errorlevel 1 ( call :fail ST_node "node 1/7" "Node install via Volta failed after 3 attempts. If behind a TLS proxy set KIRO_INSECURE_TLS=1 and re-run; otherwise check network/proxy." & exit /b 1 )
call :done ST_node
:step_pnpm

REM ===========================================================================
REM STEP 2/7 - pnpm
REM ===========================================================================
echo.
echo [step] pnpm (2/7)
where pnpm >nul 2>nul && ( echo   [SKIPPED] pnpm already present on PATH ^(strict skip^) & call :done ST_pnpm & goto :step_uv )
call :installPnpm
if errorlevel 1 ( call :fail ST_pnpm "pnpm 2/7" "pnpm install via Volta failed after 3 attempts. Ensure Volta is installed and VOLTA_FEATURE_PNPM is enabled, then re-run." & exit /b 1 )
call :done ST_pnpm
:step_uv

REM ===========================================================================
REM STEP 3/7 - uv
REM ===========================================================================
echo.
echo [step] uv (3/7)
where uv >nul 2>nul && ( echo   [SKIPPED] uv already present on PATH ^(strict skip^) & call :done ST_uv & goto :step_task )
call :installUv
if errorlevel 1 ( call :fail ST_uv "uv 3/7" "uv install via Scoop failed after 3 attempts. Check network/proxy, then re-run." & exit /b 1 )
call :done ST_uv
:step_task

REM ===========================================================================
REM STEP 4/7 - task
REM ===========================================================================
echo.
echo [step] task (4/7)
where task >nul 2>nul && ( echo   [SKIPPED] task already present on PATH ^(strict skip^) & call :done ST_task & goto :step_pm2 )
call :installTask
if errorlevel 1 ( call :fail ST_task "task 4/7" "task install via Scoop failed after 3 attempts. Check network/proxy, then re-run." & exit /b 1 )
call :done ST_task
:step_pm2

REM ===========================================================================
REM STEP 5/7 - pm2
REM ===========================================================================
echo.
echo [step] pm2 (5/7)
where pm2 >nul 2>nul && ( echo   [SKIPPED] pm2 already present on PATH ^(strict skip^) & call :done ST_pm2 & goto :aux_steps )
call :installPm2
if errorlevel 1 ( call :fail ST_pm2 "pm2 5/7" "pm2 install via Volta failed after 3 attempts. Ensure Volta is installed, then re-run." & exit /b 1 )
call :done ST_pm2
:aux_steps

REM ===========================================================================
REM AUX (not part of the 5-tool verify) - gb.bat shim + Git Bash tweaks
REM These are conveniences; failures here only warn and never abort setup.
REM Android is decoupled (opt-in via `task setup-android`) and NOT done here.
REM ===========================================================================
echo.
echo [aux] Installing gb.bat shim and Git Bash tweaks
if not exist "%USER_LOCAL%" mkdir "%USER_LOCAL%"
copy /Y "%SETUP_ROOT%windows\gb.bat" "%USER_LOCAL%\" >nul 2>nul
powershell -NoProfile -Command "$userPath=[Environment]::GetEnvironmentVariable('PATH','User'); if ($userPath -notmatch [regex]::Escape('%USER_LOCAL%')) { [Environment]::SetEnvironmentVariable('PATH','%USER_LOCAL%;'+$userPath,'User') }" 2>nul
call :refreshPath
if exist "C:\Program Files\Git\bin\bash.exe" ( "C:\Program Files\Git\bin\bash.exe" "%SETUP_ROOT%windows\set-git-bash.sh" 2>nul ) else ( echo   [warn] Git Bash not found at default path - skipping profile tweaks )

echo.
echo [aux] Android is opt-in and NOT part of core setup. Run "task setup-android" to install the Android SDK + emulator.

echo.
call :shellDecouple

REM ===========================================================================
REM STEP 6/7 - install-deps (Workspace_Package + Python_Tool)
REM ===========================================================================
echo.
echo [step] install-deps (6/7)
if /I "%ST_install_deps%"=="done" ( echo   [SKIPPED] dependencies already installed ^(state: done^) & goto :step_starthub )
call :installDeps
if errorlevel 1 ( call :fail ST_install_deps "install-deps 6/7" "Dependency install failed. Check the failing command above; verify network and that pnpm-lock.yaml/uv.lock match, then re-run." & exit /b 1 )
call :done ST_install_deps
:step_starthub

REM ===========================================================================
REM STEP 7/7 - start-hub
REM ===========================================================================
echo.
echo [step] start-hub (7/7)
if /I "%ST_start_hub%"=="done" ( echo   [SKIPPED] Hub already started ^(state: done^) & goto :verify_all )
call :startHub
if errorlevel 1 ( call :fail ST_start_hub "start-hub 7/7" "Hub failed to build or start. Inspect the build/pm2 output above; run 'pm2 logs' for details, then re-run." & exit /b 1 )
call :done ST_start_hub
:verify_all

REM ===========================================================================
REM VERIFY - only AFTER every step above completed. Missing tool ->
REM report names + exit non-zero.
REM ===========================================================================
echo.
echo [verify] Verifying all 5 Core tools on PATH (post-setup)
echo ---------------------------------------------------
call :refreshPath
set "MISSING="
call :verify node "node -v"
call :verify pnpm "pnpm -v"
call :verify uv "uv --version"
call :verify task "task --version"
call :verify pm2 "pm2 -v"
echo ---------------------------------------------------
if defined MISSING (
    echo.
    echo   [error] Verification failed. Missing on PATH:!MISSING!
    echo   [hint]  Open a NEW terminal to refresh PATH, then re-run this script; completed steps are skipped.
    exit /b 1
)

echo.
echo ===================================================
echo   SETUP COMPLETED - Hub started, all 5 Core tools verified
echo ===================================================
echo   Open http://localhost:5174
echo ===================================================
if not defined KIRO_NO_PAUSE pause
exit /b 0


REM ===========================================================================
REM Helper functions
REM ===========================================================================

REM ---------------------------------------------------------------------------
REM :loadState
REM Read the persisted ledger into ST_<step> variables. A step recorded as
REM 'done' (whether it was installed or strict-SKIPPED last run) is preserved
REM so a re-run skips it. Uses node when available (canonical JSON
REM parse); otherwise falls back to findstr so the very first run -- before
REM node exists -- still works.
REM ---------------------------------------------------------------------------
:loadState
set "ST_node="
set "ST_pnpm="
set "ST_uv="
set "ST_task="
set "ST_pm2="
set "ST_install_deps="
set "ST_start_hub="
if not exist "%STATE_FILE%" goto :eof
where node >nul 2>nul
if not errorlevel 1 (
    for /f "usebackq tokens=1,2 delims=:" %%A in (`node "%SETUP_ROOT%setup-state.mjs" read "%STATE_FILE%"`) do (
        if /I "%%A"=="node" set "ST_node=%%B"
        if /I "%%A"=="pnpm" set "ST_pnpm=%%B"
        if /I "%%A"=="uv" set "ST_uv=%%B"
        if /I "%%A"=="task" set "ST_task=%%B"
        if /I "%%A"=="pm2" set "ST_pm2=%%B"
        if /I "%%A"=="install-deps" set "ST_install_deps=%%B"
        if /I "%%A"=="start-hub" set "ST_start_hub=%%B"
    )
    goto :eof
)
REM --- node-less fallback: crude "name":"status" scan via findstr ---
call :scanState node ST_node
call :scanState pnpm ST_pnpm
call :scanState uv ST_uv
call :scanState task ST_task
call :scanState pm2 ST_pm2
call :scanState install-deps ST_install_deps
call :scanState start-hub ST_start_hub
goto :eof

REM :scanState <stepName> <varName> -- set var=done only if "name":"done" present
:scanState
findstr /I /C:"\"%~1\": \"done\"" "%STATE_FILE%" >nul 2>nul && set "%~2=done"
findstr /I /C:"\"%~1\":\"done\"" "%STATE_FILE%" >nul 2>nul && set "%~2=done"
goto :eof

REM ---------------------------------------------------------------------------
REM :writeState
REM Persist current ST_<step> vars to .setup-state.json in the canonical
REM shape { "steps": {..}, "updatedAt": ".." }. Steps with no recorded value
REM are written as "pending". Prefers node for a correct atomic write; the
REM node-less fallback emits the same flat JSON by hand so early steps (before
REM node is installed) keep the ledger re-runnable.
REM ---------------------------------------------------------------------------
:writeState
where node >nul 2>nul
if not errorlevel 1 (
    node "%SETUP_ROOT%setup-state.mjs" write "%STATE_FILE%" "node=%ST_node%" "pnpm=%ST_pnpm%" "uv=%ST_uv%" "task=%ST_task%" "pm2=%ST_pm2%" "install-deps=%ST_install_deps%" "start-hub=%ST_start_hub%" >nul 2>nul
    goto :eof
)
call :stOr ST_node
set "_n=%_v%"
call :stOr ST_pnpm
set "_p=%_v%"
call :stOr ST_uv
set "_u=%_v%"
call :stOr ST_task
set "_t=%_v%"
call :stOr ST_pm2
set "_m=%_v%"
call :stOr ST_install_deps
set "_d=%_v%"
call :stOr ST_start_hub
set "_h=%_v%"
for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')"`) do set "_ts=%%T"
(
  echo {
  echo   "steps": {
  echo     "node": "%_n%",
  echo     "pnpm": "%_p%",
  echo     "uv": "%_u%",
  echo     "task": "%_t%",
  echo     "pm2": "%_m%",
  echo     "install-deps": "%_d%",
  echo     "start-hub": "%_h%"
  echo   },
  echo   "updatedAt": "%_ts%"
  echo }
) > "%STATE_FILE%"
goto :eof

REM :stOr <varName> -- _v = value of var, or "pending" if empty
:stOr
call set "_v=%%%~1%%"
if not defined _v set "_v=pending"
goto :eof

REM ---------------------------------------------------------------------------
REM :done <varName> mark a step 'done' (covers strict-SKIPPED tools too) and
REM persist immediately so progress/state update on every
REM step change and a crash mid-run stays re-runnable.
REM ---------------------------------------------------------------------------
:done
set "%~1=done"
call :writeState
goto :eof

REM ---------------------------------------------------------------------------
REM :fail <varName> "<step N/M>" "<remediation>"
REM Mark the step 'failed', persist, print the failing step name + >=1 fix
REM hint, and DO NOT start the Hub or any later component.
REM Prior 'done' steps are left untouched in the ledger.
REM ---------------------------------------------------------------------------
:fail
set "%~1=failed"
call :writeState
echo.
echo   [error] Setup stopped at step: %~2
echo   [hint]  %~3
echo   [state] Progress saved to "%STATE_FILE%". Re-run to resume; completed steps are skipped.
if not defined KIRO_NO_PAUSE pause
goto :eof

REM ---------------------------------------------------------------------------
REM :verify <command> "<version-cmd>"
REM Append to MISSING when the command is not on PATH. Prints OK + version.
REM ---------------------------------------------------------------------------
:verify
where %~1 >nul 2>nul
if errorlevel 1 (
    echo   [MISSING] %~1
    set "MISSING=!MISSING! %~1"
    goto :eof
)
for /f "delims=" %%v in ('%~2 2^>nul') do (
    echo   [OK] %~1: %%v
    goto :eof
)
echo   [OK] %~1
goto :eof

REM ---------------------------------------------------------------------------
REM :refreshPath
REM Re-read persisted PATH (Machine + User) into this cmd session. Required
REM after any installer that mutates PATH (scoop, volta, uv).
REM ---------------------------------------------------------------------------
:refreshPath
for /f "usebackq tokens=* delims=" %%P in (`powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%P;%SCOOP_SHIMS%;%VOLTA_BIN%;%USER_LOCAL%"
goto :eof

REM ---------------------------------------------------------------------------
REM :ensureScoop
REM Idempotently bootstrap scoop (the user-scope package manager on Windows,
REM R20.5). Retries the network install up to 3x. Returns errorlevel 1 on
REM total failure so the caller can name the failing tool/step.
REM ---------------------------------------------------------------------------
:ensureScoop
where scoop >nul 2>nul
if not errorlevel 1 goto :eof
echo   Installing Scoop (user-scope package manager)...
set /a _try=0
:scoop_retry
set /a _try+=1
powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force; Invoke-RestMethod get.scoop.sh | Invoke-Expression"
call :refreshPath
where scoop >nul 2>nul && goto :eof
if %_try% LSS 3 ( echo   [retry %_try%/3] Scoop install failed - retrying & goto :scoop_retry )
echo   [error] Scoop install failed after 3 attempts.
exit /b 1

REM ---------------------------------------------------------------------------
REM :scoopInstall <pkg> [aliasCmd]
REM Install one scoop package with <=3 network retries (R20.2 - scoop applies
REM its own per-download timeout). User-scope, no admin needed.
REM aliasCmd defaults to <pkg> for the post-install PATH check.
REM ---------------------------------------------------------------------------
:scoopInstall
call :ensureScoop || exit /b 1
set "_pkg=%~1"
set "_cmd=%~2"
if "%_cmd%"=="" set "_cmd=%_pkg%"
set /a _try=0
:scoopInstall_retry
set /a _try+=1
call scoop install %_pkg%
call :refreshPath
where %_cmd% >nul 2>nul && goto :eof
if %_try% LSS 3 ( echo   [retry %_try%/3] %_pkg% install failed - retrying & goto :scoopInstall_retry )
exit /b 1

REM ---------------------------------------------------------------------------
REM :ensureVolta -- node/pnpm/pm2 come from Volta; install it via scoop first.
REM ---------------------------------------------------------------------------
:ensureVolta
where volta >nul 2>nul
if not errorlevel 1 goto :eof
call :scoopInstall volta volta || exit /b 1
goto :eof

REM ---------------------------------------------------------------------------
REM :installNode -- Volta install of pinned Node (user-scope). Optional curl -k
REM prefetch for KIRO_INSECURE_TLS. <=3 retries, then fail.
REM ---------------------------------------------------------------------------
:installNode
call :ensureVolta || exit /b 1
setx VOLTA_FEATURE_PNPM 1 >nul 2>nul
set "VOLTA_FEATURE_PNPM=1"
if "%KIRO_INSECURE_TLS%"=="1" (
    echo   [warn] KIRO_INSECURE_TLS=1 - prefetching Node tarball via curl -k
    set "VOLTA_INVENTORY=%USERPROFILE%\scoop\apps\volta\current\appdata\tools\inventory\node"
    if not exist "!VOLTA_INVENTORY!" mkdir "!VOLTA_INVENTORY!"
    curl.exe -k -L --retry 3 --max-time 30 -o "!VOLTA_INVENTORY!\node-v%NODE_VERSION%-win-x64.zip" "https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-win-x64.zip"
)
set /a _try=0
:installNode_retry
set /a _try+=1
call volta install node@%NODE_VERSION%
call :refreshPath
where node >nul 2>nul && goto :eof
if %_try% LSS 3 ( echo   [retry %_try%/3] node install failed - retrying & goto :installNode_retry )
exit /b 1

REM ---------------------------------------------------------------------------
REM :installPnpm -- pnpm via Volta (VOLTA_FEATURE_PNPM). <=3 retries.
REM ---------------------------------------------------------------------------
:installPnpm
call :ensureVolta || exit /b 1
set "VOLTA_FEATURE_PNPM=1"
set /a _try=0
:installPnpm_retry
set /a _try+=1
call volta install pnpm
call :refreshPath
where pnpm >nul 2>nul && goto :eof
if %_try% LSS 3 ( echo   [retry %_try%/3] pnpm install failed - retrying & goto :installPnpm_retry )
exit /b 1

REM :installUv -- uv via scoop (user-scope). <=3 retries inside :scoopInstall.
:installUv
call :scoopInstall uv uv || exit /b 1
goto :eof

REM :installTask -- task via scoop. <=3 retries inside :scoopInstall.
:installTask
call :scoopInstall task task || exit /b 1
goto :eof

REM ---------------------------------------------------------------------------
REM :installPm2 -- pm2 (+ kill-port) via Volta. <=3 install retries.
REM Boot auto-start is NOT tied to pm2 anymore: it is registered later in
REM :startHub via the Hub launcher (hub-service.mjs enable-boot), which is
REM PM2-independent -- no pm2 dump or `pm2 resurrect` needed, so the Hub
REM auto-starts at login even when PM2 is blocked (EPERM named pipe).
REM ---------------------------------------------------------------------------
:installPm2
call :ensureVolta || exit /b 1
set /a _try=0
:installPm2_retry
set /a _try+=1
call volta install pm2 kill-port
call :refreshPath
where pm2 >nul 2>nul && goto :eof
if %_try% LSS 3 ( echo   [retry %_try%/3] pm2 install failed - retrying & goto :installPm2_retry )
exit /b 1

REM ---------------------------------------------------------------------------
REM :installDeps -- Workspace_Package deps (pnpm install) + Python_Tool deps
REM (uv python install + uv sync). Any failure aborts without
REM starting later steps. Playwright browsers handled by `task setup` later.
REM ---------------------------------------------------------------------------
:installDeps
echo   Installing Node workspace dependencies (pnpm install)...
call pnpm -C "%WORKSPACE_ROOT%" install
if errorlevel 1 ( echo   [error] pnpm install failed. & exit /b 1 )
echo   Installing per-tool dependencies (isolated, pnpm)...
for /d %%T in ("%WORKSPACE_ROOT%\tools\*") do (
    if exist "%%T\package.json" (
        echo     [deps] %%~nxT
        call pnpm -C "%%T" install --ignore-workspace || ( echo   [error] pnpm install failed for %%~nxT. & exit /b 1 )
    )
)
REM ---- Python toolchain (NON-FATAL) -------------------------------------------
REM Python is needed ONLY by the robot-framework tool. On a locked-down network
REM (corporate proxy/policy) the download can fail -- that must NOT abort setup.
REM So we WARN and CONTINUE, leaving the Hub to start. The user finishes later
REM with one click from the Hub: Environment > Install Python
REM (POST /api/doctor/install-python), or by re-running the command shown.
echo   Installing Python toolchain (uv python install %PYTHON_VERSION%)...
call uv python install %PYTHON_VERSION% --native-tls
if errorlevel 1 (
    echo   [warn] uv python install failed - SKIPPING Python for now ^(non-fatal^).
    echo   [hint] Finish later from the Hub ^(Environment ^> Install Python^) or re-run:
    echo          uv python install %PYTHON_VERSION% --native-tls
) else (
    REM uv sync only when a uv tool is present. robot-framework is a declared uv
    REM workspace member, so `uv sync` errors if its folder is absent (fresh clone).
    if exist "%WORKSPACE_ROOT%\tools\robot-framework\pyproject.toml" (
        echo   Syncing Python dependencies (uv sync)...
        call uv sync --all-packages --native-tls --project "%WORKSPACE_ROOT%"
        if errorlevel 1 (
            echo   [warn] uv sync failed - robot-framework Python deps are incomplete ^(non-fatal^).
            echo   [hint] Finish later from the Hub ^(Environment ^> Install Python^) or re-run:
            echo          uv sync --all-packages --native-tls --project "%WORKSPACE_ROOT%"
        )
    ) else (
        echo   [skip] uv sync -- no uv tool (tools/robot-framework) present
    )
)
call uv tool install uv-up 2>nul
goto :eof

REM ---------------------------------------------------------------------------
REM :startHub -- build the Hub bundle and start it under pm2 using the shared
REM ecosystem file (single source of truth for app name/port). Any failure
REM aborts.
REM ---------------------------------------------------------------------------
:startHub
echo   Building Hub (shared + server + client)...
call pnpm -C "%WORKSPACE_ROOT%\hub" run build
if errorlevel 1 ( echo   [error] Hub build failed. & exit /b 1 )
REM Delegate process management to the shared launcher, which pins PM2_HOME,
REM frees the port, starts via PM2, and AUTOMATICALLY falls back to a daemonless
REM background process when PM2 is blocked (EPERM named pipe on Node 25/26 /
REM locked-down Windows).
setx PM2_HOME "%USERPROFILE%\.pm2" >nul 2>nul
echo   Starting Hub (PM2 with automatic daemonless fallback)...
call node "%WORKSPACE_ROOT%\hub\bin\hub-service.mjs" start
if errorlevel 1 ( echo   [error] Hub failed to start. Run "node hub\bin\hub-service.mjs status" for details. & exit /b 1 )
REM Register PM2-independent boot auto-start (user-scope logon Scheduled Task).
REM Best-effort: warns but never aborts setup if it cannot register.
echo   Enabling auto-start at login...
call node "%WORKSPACE_ROOT%\hub\bin\hub-service.mjs" enable-boot
goto :eof

REM ---------------------------------------------------------------------------
REM :shellDecouple (Layer D, R11 - ON BY DEFAULT, best-effort, NEVER a Core step)
REM Exposes Git's bundled GNU set (<Git>\usr\bin: date whoami sed cp mv mkdir rm
REM basename dirname cat tee seq sleep head ...) on the USER PATH so the Taskfile
REM externals resolve when running `task` from cmd, PowerShell, and Git Bash.
REM Opt OUT with KIRO_DISABLE_SHELL_DECOUPLE=1. It is best-effort: any failure
REM only warns and never aborts setup, so it can never block a Core install
REM (R11.4 - never a Core precondition).
REM
REM Why default-on is now SAFE + SUFFICIENT: the Taskfiles no longer call the
REM GNU-only `find` (the empty-dir prune, the artifact/node_modules sweeps, and
REM the `.git` discovery in `pull` were ported to Node helpers under
REM scripts/lib/, invoked via the always-present Core `node`). With GNU `find`
REM gone from every recipe, the ONLY externals that collide with a System32
REM twin (`find`/`sort`) are no longer needed by `task` at all -- so appending
REM Git's usr\bin to the USER PATH makes EVERY remaining (non-colliding) external
REM resolvable in cmd/PowerShell, and `task` runs every recipe cross-shell.
REM
REM PATH ordering - the strategy was VERIFIED, not assumed, against the
REM installed task 3.x / mvdan.cc/sh:
REM * `task` runs recipes through mvdan/sh, which resolves an external by
REM walking PATH front-to-back exactly like native Windows - there is no
REM Task-only lookup. (Verified: a System32-first PATH made `task` resolve
REM C:\WINDOWS\system32\find.exe; a Git-usr-bin-first PATH gave GNU
REM find.exe.)
REM * Windows builds a process PATH as Machine-scope FIRST, then User-scope.
REM System32 lives in the Machine PATH, so anything appended to the USER
REM PATH lands AFTER System32. We therefore APPEND (never prepend) here:
REM native find.exe / sort.exe keep winning for bare `find`/`sort` in
REM cmd/PowerShell (R11.3) - they continue to function untouched - while the
REM GNU tools with NO System32 twin resolve from <Git>\usr\bin in every shell.
REM No recipe depends on GNU `find`/`sort` any more, so native precedence for
REM those two names is purely a safety guarantee, not a functional limit.
REM * Git Bash already puts its own /usr/bin first - `task` from Git Bash also
REM runs every recipe.
REM ---------------------------------------------------------------------------
:shellDecouple
if /I "%KIRO_DISABLE_SHELL_DECOUPLE%"=="1" (
    echo   [opt] Shell decoupling SKIPPED ^(KIRO_DISABLE_SHELL_DECOUPLE=1^). Cross-shell `task` not configured this run; native commands are unaffected.
    goto :eof
)
echo   [opt] Shell decoupling ON ^(default^) - exposing Git's bundled GNU tools on the user PATH for cross-shell `task`.
REM Resolve <Git>\usr\bin robustly - prefer the dir of `git` on PATH, then probe
REM the common install locations (Program Files, Program Files x86, user-scope
REM Programs\Git). A candidate is accepted only if it actually contains find.exe;
REM never hardcode a single path.
set "GIT_USRBIN="
for /f "delims=" %%G in ('where git 2^>nul') do (
    if not defined GIT_USRBIN call :deriveGitUsrBin "%%G"
)
if not defined GIT_USRBIN call :probeGitUsrBin "%ProgramFiles%\Git\usr\bin"
if not defined GIT_USRBIN call :probeGitUsrBin "%ProgramW6432%\Git\usr\bin"
if not defined GIT_USRBIN call :probeGitUsrBin "%ProgramFiles(x86)%\Git\usr\bin"
if not defined GIT_USRBIN call :probeGitUsrBin "%LOCALAPPDATA%\Programs\Git\usr\bin"
if not defined GIT_USRBIN (
    echo   [warn] Could not locate Git's usr\bin ^(GNU tools^). Install Git for Windows and re-run setup to enable cross-shell `task`; native commands are unaffected.
    goto :eof
)
echo   Using GNU tools dir: "%GIT_USRBIN%"
REM Append to the USER PATH idempotently (regex-escape guard mirrors the gb.bat
REM aux step). Build "<existing>;<gitUsrBin>" so the entry lands AFTER System32
REM in the composed Machine+User PATH - native find.exe/sort.exe keep precedence
REM for cmd/PowerShell callers, the non-colliding GNU tools become
REM resolvable in every shell. User scope only - no elevation.
powershell -NoProfile -Command "$p=[Environment]::GetEnvironmentVariable('PATH','User'); if ($p -notmatch [regex]::Escape($env:GIT_USRBIN)) { [Environment]::SetEnvironmentVariable('PATH', ($p.TrimEnd(';') + ';' + $env:GIT_USRBIN), 'User') }" 2>nul
if errorlevel 1 (
    echo   [warn] Could not persist the user PATH entry. Cross-shell `task` decoupling was not applied; native commands are unaffected.
    goto :eof
)
call :refreshPath
echo   [ok] Appended "%GIT_USRBIN%" to the user PATH.
echo   [note] Cross-shell `task` now works by default: cmd, PowerShell, and Git Bash
echo          all resolve the GNU tools the recipes use. No recipe needs GNU find/sort,
echo          so bare find/sort stay the native Windows binaries ^(System32 precedence^).
goto :eof

REM :deriveGitUsrBin "<path-to-git.exe>" -- git.exe sits at <Git>\cmd|bin\git.exe
REM or <Git>\mingw64\bin\git.exe; probe ..\usr\bin and ..\..\usr\bin relative
REM to its dir and accept the one that contains find.exe.
:deriveGitUsrBin
call :probeGitUsrBin "%~dp1..\usr\bin"
call :probeGitUsrBin "%~dp1..\..\usr\bin"
goto :eof

REM :probeGitUsrBin "<candidate usr\bin>" -- set GIT_USRBIN (normalized, no ..)
REM iff the candidate exists and contains find.exe. First match wins.
:probeGitUsrBin
if defined GIT_USRBIN goto :eof
for %%I in ("%~1") do set "_cand=%%~fI"
if exist "!_cand!\find.exe" set "GIT_USRBIN=!_cand!"
goto :eof
