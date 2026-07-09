#!/usr/bin/env bash
# ============================================================================
#  ONE-CLICK INSTALLER (Linux / macOS)
# ----------------------------------------------------------------------------
#  Standalone file — distribute this SINGLE .sh. End user runs:  ./install.sh
#  Everything is handled: git clone + toolchain install + deps + Hub start.
#
#  Target Directory defaults to the CURRENT directory if the user presses
#  Enter without typing anything — no input is mandatory.
#
#  Prerequisites: a POSIX shell + curl (present on any modern Linux/macOS).
# ============================================================================

set -uo pipefail

REPO_URL="https://github.com/decha2543/automated-test-one-stop-services.git"

echo "==================================================="
echo "  AUTOMATED TEST ONE-STOP SERVICE — INSTALLER"
echo "==================================================="
echo "  This will clone the workspace and install"
echo "  everything needed to run the test automation Hub."
echo "==================================================="

# ---------------------------------------------------------------------------
# Ask for Target Directory (default = current directory)
# ---------------------------------------------------------------------------
echo ""
TARGET=""
read -r -p "Enter Target Directory [default: current dir]: " TARGET || true

# Trim whitespace
TARGET="${TARGET#"${TARGET%%[![:space:]]*}"}"
TARGET="${TARGET%"${TARGET##*[![:space:]]}"}"

# Default to current directory if empty
if [ -z "$TARGET" ]; then
  TARGET="."
fi

# Expand ~ and resolve to absolute
TARGET=$(eval echo "$TARGET")
if [ -d "$TARGET" ]; then
  TARGET=$(cd "$TARGET" && pwd)
else
  # Parent must exist for resolution; create target below
  parent=$(dirname "$TARGET")
  if [ -d "$parent" ]; then
    TARGET="$(cd "$parent" && pwd)/$(basename "$TARGET")"
  fi
fi

echo ""
echo "  Target: $TARGET"

# ---------------------------------------------------------------------------
# Create target directory if needed
# ---------------------------------------------------------------------------
if [ ! -d "$TARGET" ]; then
  if ! mkdir -p "$TARGET" 2>/dev/null; then
    echo "  [error] Cannot create directory: $TARGET"
    echo "  [hint]  Check the path and permissions."
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Ensure git is available
# ---------------------------------------------------------------------------
if ! command -v git &>/dev/null; then
  echo ""
  echo "  [install] git not found — installing..."
  if command -v brew &>/dev/null; then
    brew install git
  elif command -v apt-get &>/dev/null; then
    sudo apt-get update -qq && sudo apt-get install -y git
  elif command -v dnf &>/dev/null; then
    sudo dnf install -y git
  else
    echo "  [error] Cannot install git automatically."
    echo "  [hint]  Install git manually, then re-run."
    exit 1
  fi
  if ! command -v git &>/dev/null; then
    echo "  [error] git still not available after install attempt."
    exit 1
  fi
  echo "  [OK] git installed"
fi

# ---------------------------------------------------------------------------
# Clone or update the repository
# ---------------------------------------------------------------------------
WORKSPACE="$TARGET/automated-test-one-stop-service"

if [ -d "$WORKSPACE/.git" ]; then
  echo ""
  echo "  [update] Repository already exists — pulling latest..."
  git -C "$WORKSPACE" pull --ff-only || echo "  [warn] git pull failed — continuing with existing code"
else
  echo ""
  echo "  [clone] Cloning repository..."
  if ! git clone --depth 1 "$REPO_URL" "$WORKSPACE"; then
    echo "  [error] git clone failed. Check network and the URL:"
    echo "          $REPO_URL"
    exit 1
  fi
  echo "  [OK] Repository cloned"
fi

# ---------------------------------------------------------------------------
# Run the setup bootstrap
# ---------------------------------------------------------------------------
echo ""
echo "==================================================="
echo "  Running setup (toolchain + deps + Hub start)..."
echo "==================================================="

KIRO_SETUP_STATE_DIR="$WORKSPACE" bash "$WORKSPACE/scripts/setup/setup-linux.sh"
SETUP_RC=$?

if [ "$SETUP_RC" -ne 0 ]; then
  echo ""
  echo "  [error] Setup failed (exit code $SETUP_RC)."
  echo "  See messages above. Fix the issue and re-run this installer."
  exit 1
fi

# ---------------------------------------------------------------------------
# Wait for Hub to be ready
# ---------------------------------------------------------------------------
echo ""
echo "  Waiting for Hub on http://localhost:5174 (up to 60s)..."

HUB_READY=0
for _poll in $(seq 1 60); do
  if curl -fsS --max-time 3 http://localhost:5174 >/dev/null 2>&1; then
    HUB_READY=1
    break
  fi
  sleep 1
done

if [ "$HUB_READY" -eq 1 ]; then
  echo ""
  echo "==================================================="
  echo "  DONE! Hub is running."
  echo "  Open: http://localhost:5174"
  echo "==================================================="
  echo ""
  echo "  Workspace: $WORKSPACE"
  echo "  Update:    git -C \"$WORKSPACE\" pull"
  echo ""
  exit 0
fi

echo ""
echo "  [error] Hub did not start within 60s."
echo "  [hint]  Check the Hub status: node hub/bin/hub-service.mjs status (logs: hub/.run/hub.log)"
exit 1
