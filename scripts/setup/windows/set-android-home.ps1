# ==========================
# set-android-home.ps1
# ==========================
# Configures ANDROID_HOME, bootstraps the Android command-line tools when they
# are missing (downloads + extracts the cmdline-tools), installs the Android
# system image / emulator / platform-tools, and creates the QA_Emulator AVD if
# it does not already exist. Self-contained: it does NOT require a pre-installed
# Android Studio. Invoked by `task setup-android` (the single opt-in entry point).
#
# Parameters:
#   -AndroidApi   API level for the system image (default: 34 = Android 14).
#                 Override via the parameter or the KIRO_ANDROID_API env var
#                 (forwarded by setup-windows.bat).
#
# Re-runnable: existing AVDs are detected and preserved unless the user
# explicitly opts in to overwriting them via KIRO_RECREATE_AVD=1.

param(
    [string]$AndroidApi = $env:KIRO_ANDROID_API
)

if (-not $AndroidApi) {
    $AndroidApi = "34"
}

# Config: Android SDK path
$androidDir = "$env:USERPROFILE\AppData\Local\Android\Sdk"

Write-Host ""
Write-Host "Setting ANDROID_HOME to $androidDir ..."
[System.Environment]::SetEnvironmentVariable("ANDROID_HOME", $androidDir, "User")
$env:ANDROID_HOME = $androidDir

# === Update PATH permanently (User level) ===
$currentPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
$androidTools = @(
    "$androidDir\emulator",
    "$androidDir\platform-tools",
    "$androidDir\cmdline-tools\latest\bin"
)

foreach ($tool in $androidTools) {
    if ($currentPath -notlike "*$tool*") {
        $currentPath += ";$tool"
        $env:PATH += ";$tool"
        Write-Host "PATH updated with: $tool"
    }
}
[System.Environment]::SetEnvironmentVariable("Path", $currentPath, "User")

Write-Host ""
Write-Host "[1/3] Checking Android Command Line Tools..."
$sdkManager = "$androidDir\cmdline-tools\latest\bin\sdkmanager.bat"
if (-not (Test-Path $sdkManager)) {
    Write-Host "Command Line Tools not found - bootstrapping into $androidDir ..."
    # Resolve the current commandlinetools zip URL from the official downloads
    # page so the build number is never pinned. Override with KIRO_ANDROID_CLT_URL
    # for offline / internal-mirror installs.
    # ponytail: scraping developer.android.com for the URL has a ceiling (page
    # markup change / network-gated). Upgrade path: set KIRO_ANDROID_CLT_URL to a
    # mirrored commandlinetools-win-<build>_latest.zip.
    $cltUrl = $env:KIRO_ANDROID_CLT_URL
    if (-not $cltUrl) {
        try {
            $studio = Invoke-WebRequest -UseBasicParsing -Uri "https://developer.android.com/studio"
            $cltUrl = [regex]::Match($studio.Content, "https://dl\.google\.com/android/repository/commandlinetools-win-[0-9]+_latest\.zip").Value
        } catch {
            Write-Host "[ERROR] Could not reach developer.android.com to resolve the Command Line Tools URL." -ForegroundColor Red
        }
    }
    if (-not $cltUrl) {
        Write-Host "[ERROR] Command Line Tools URL unavailable." -ForegroundColor Red
        Write-Host "Set KIRO_ANDROID_CLT_URL to a commandlinetools-win-<build>_latest.zip and re-run." -ForegroundColor Yellow
        exit 1
    }
    $cltZip = Join-Path $env:TEMP "commandlinetools-win.zip"
    $cltTmp = Join-Path $env:TEMP "android-clt-extract"
    Write-Host "Downloading $cltUrl ..."
    Invoke-WebRequest -UseBasicParsing -Uri $cltUrl -OutFile $cltZip
    if (Test-Path $cltTmp) { Remove-Item -Recurse -Force $cltTmp }
    Expand-Archive -Path $cltZip -DestinationPath $cltTmp -Force
    # The zip unpacks to a top-level cmdline-tools\ (older builds: tools\); the
    # SDK layout expects it under cmdline-tools\latest\.
    $cltSrc = if (Test-Path "$cltTmp\cmdline-tools") { "$cltTmp\cmdline-tools" } elseif (Test-Path "$cltTmp\tools") { "$cltTmp\tools" } else { $null }
    if (-not $cltSrc) {
        Write-Host "[ERROR] Unexpected Command Line Tools archive layout." -ForegroundColor Red
        exit 1
    }
    New-Item -ItemType Directory -Force -Path "$androidDir\cmdline-tools\latest" | Out-Null
    Copy-Item -Recurse -Force "$cltSrc\*" "$androidDir\cmdline-tools\latest\"
    Remove-Item -Recurse -Force $cltTmp
    Remove-Item -Force $cltZip
    if (-not (Test-Path $sdkManager)) {
        Write-Host "[ERROR] sdkmanager still not found after bootstrap at $sdkManager" -ForegroundColor Red
        exit 1
    }
    Write-Host "Command Line Tools installed." -ForegroundColor Green
}

$systemImage = "system-images;android-$AndroidApi;google_apis;x86_64"

Write-Host ""
Write-Host "[2/3] Installing Android API $AndroidApi system image + emulator + platform-tools..."
cmd.exe /c "echo y | `"$sdkManager`" --licenses > NUL"
$installResult = cmd.exe /c "`"$sdkManager`" `"$systemImage`" `"emulator`" `"platform-tools`"" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] sdkmanager install failed (exit code $LASTEXITCODE)" -ForegroundColor Red
    Write-Host $installResult
    exit 1
}

Write-Host ""
Write-Host "[3/3] Creating QA_Emulator AVD..."
$avdManager = "$androidDir\cmdline-tools\latest\bin\avdmanager.bat"
if (-not (Test-Path $avdManager)) {
    Write-Host "[ERROR] avdmanager not found - system image installed but AVD not created." -ForegroundColor Red
    exit 1
}

# Detect an existing QA_Emulator AVD before clobbering user data.
$avdList = & cmd.exe /c "`"$avdManager`" list avd" 2>$null
$avdExists = $avdList -match "Name:\s+QA_Emulator"

if ($avdExists -and -not $env:KIRO_RECREATE_AVD) {
    Write-Host "QA_Emulator already exists - keeping current AVD." -ForegroundColor Cyan
    Write-Host "Set KIRO_RECREATE_AVD=1 to overwrite it." -ForegroundColor DarkGray
} else {
    if ($avdExists) {
        Write-Host "KIRO_RECREATE_AVD=1 set - overwriting existing QA_Emulator..." -ForegroundColor Yellow
    }
    cmd.exe /c "echo no | `"$avdManager`" create avd -n QA_Emulator -k `"$systemImage`" --device `"pixel`" --force"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "QA_Emulator created (Android API $AndroidApi)." -ForegroundColor Green
    } else {
        Write-Host "[ERROR] AVD create failed (exit $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "==================================================="
Write-Host "ANDROID ENVIRONMENT SETUP COMPLETE"
Write-Host "Close and reopen your terminal to apply PATH changes."
Write-Host "==================================================="
