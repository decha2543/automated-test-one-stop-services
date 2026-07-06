#!/usr/bin/env bash
# ==========================
# set-android-home.sh
# ==========================
# macOS/Linux counterpart of scripts/setup/windows/set-android-home.ps1.
# Configures ANDROID_HOME, bootstraps the Android command-line tools when they
# are missing (downloads + extracts the cmdline-tools), installs the Android
# system image / emulator / platform-tools, and creates the QA_Emulator AVD if
# it does not already exist. Self-contained: it does NOT require a pre-installed
# Android Studio. Invoked by `task setup-android` (the single opt-in entry
# point) — it performs the SAME provisioning actions as the Windows PS1 (R3.4).
#
# Env:
#   KIRO_ANDROID_API       API level for the system image (default: 34).
#   KIRO_ANDROID_CLT_URL   Override the cmdline-tools zip URL (offline/mirror).
#   KIRO_RECREATE_AVD=1    Overwrite an existing QA_Emulator AVD.

set -uo pipefail

ANDROID_API="${KIRO_ANDROID_API:-34}"

OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
  ANDROID_HOME_DEFAULT="$HOME/Library/Android/sdk"
  CLT_OS="mac"
else
  ANDROID_HOME_DEFAULT="$HOME/Android/Sdk"
  CLT_OS="linux"
fi
ANDROID_HOME="${ANDROID_HOME:-$ANDROID_HOME_DEFAULT}"
export ANDROID_HOME

echo ""
echo "Setting ANDROID_HOME to $ANDROID_HOME ..."
mkdir -p "$ANDROID_HOME"

SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
AVDMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"

echo ""
echo "[1/3] Checking Android Command Line Tools..."
if [ ! -x "$SDKMANAGER" ]; then
  echo "Command Line Tools not found - bootstrapping into $ANDROID_HOME ..."
  if ! command -v unzip >/dev/null 2>&1; then
    echo "[ERROR] 'unzip' is required to extract the Command Line Tools. Install it and re-run." >&2
    exit 1
  fi
  # Resolve the current commandlinetools zip URL from the official downloads page
  # so the build number is never pinned. Override with KIRO_ANDROID_CLT_URL for
  # offline / internal-mirror installs.
  # ponytail: scraping developer.android.com for the URL has a ceiling (page
  # markup change / network-gated). Upgrade path: set KIRO_ANDROID_CLT_URL to a
  # mirrored commandlinetools-${CLT_OS}-<build>_latest.zip.
  clt_url="${KIRO_ANDROID_CLT_URL:-}"
  if [ -z "$clt_url" ]; then
    clt_url="$(curl -fsSL "https://developer.android.com/studio" 2>/dev/null \
      | grep -oE "https://dl\.google\.com/android/repository/commandlinetools-${CLT_OS}-[0-9]+_latest\.zip" \
      | head -n1)"
  fi
  if [ -z "$clt_url" ]; then
    echo "[ERROR] Could not resolve the Command Line Tools URL from developer.android.com." >&2
    echo "        Set KIRO_ANDROID_CLT_URL to a commandlinetools-${CLT_OS}-<build>_latest.zip and re-run." >&2
    exit 1
  fi
  work="$(mktemp -d)"
  zip="$work/commandlinetools.zip"
  extract="$work/extract"
  echo "Downloading $clt_url ..."
  if ! curl -fsSL -o "$zip" "$clt_url"; then
    echo "[ERROR] Command Line Tools download failed." >&2
    rm -rf "$work"
    exit 1
  fi
  unzip -q "$zip" -d "$extract"
  # The zip unpacks to a top-level cmdline-tools/ (older builds: tools/); the SDK
  # layout expects it under cmdline-tools/latest/.
  if [ -d "$extract/cmdline-tools" ]; then
    clt_src="$extract/cmdline-tools"
  elif [ -d "$extract/tools" ]; then
    clt_src="$extract/tools"
  else
    echo "[ERROR] Unexpected Command Line Tools archive layout." >&2
    rm -rf "$work"
    exit 1
  fi
  mkdir -p "$ANDROID_HOME/cmdline-tools/latest"
  cp -R "$clt_src"/* "$ANDROID_HOME/cmdline-tools/latest/"
  rm -rf "$work"
  if [ ! -x "$SDKMANAGER" ]; then
    echo "[ERROR] sdkmanager still not found after bootstrap at $SDKMANAGER" >&2
    exit 1
  fi
  echo "Command Line Tools installed."
fi

SYSTEM_IMAGE="system-images;android-${ANDROID_API};google_apis;x86_64"

echo ""
echo "[2/3] Installing Android API $ANDROID_API system image + emulator + platform-tools..."
yes | "$SDKMANAGER" --licenses >/dev/null 2>&1 || true
if ! "$SDKMANAGER" "$SYSTEM_IMAGE" "emulator" "platform-tools"; then
  echo "[ERROR] sdkmanager install failed." >&2
  exit 1
fi

echo ""
echo "[3/3] Creating QA_Emulator AVD..."
if [ ! -x "$AVDMANAGER" ]; then
  echo "[ERROR] avdmanager not found - system image installed but AVD not created." >&2
  exit 1
fi

if "$AVDMANAGER" list avd 2>/dev/null | grep -q "Name: QA_Emulator" && [ -z "${KIRO_RECREATE_AVD:-}" ]; then
  echo "QA_Emulator already exists - keeping current AVD."
  echo "Set KIRO_RECREATE_AVD=1 to overwrite it."
else
  echo "no" | "$AVDMANAGER" create avd -n QA_Emulator -k "$SYSTEM_IMAGE" --device "pixel" --force
  echo "QA_Emulator created (Android API $ANDROID_API)."
fi

echo ""
echo "Add to your shell profile (~/.bashrc or ~/.zshrc) to persist PATH:"
echo "  export ANDROID_HOME=\"$ANDROID_HOME\""
echo "  export PATH=\"\$PATH:\$ANDROID_HOME/emulator:\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/cmdline-tools/latest/bin\""
echo ""
echo "==================================================="
echo "ANDROID ENVIRONMENT SETUP COMPLETE"
echo "==================================================="
