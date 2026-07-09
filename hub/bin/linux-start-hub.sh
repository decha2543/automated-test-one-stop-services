#!/usr/bin/env bash
# ============================================================================
#  AutoQA Hub — build, then start as a background service (Linux/macOS).
#
#  Thin wrapper: it builds the Hub and delegates process management to
#  hub/bin/hub-service.mjs, which runs the Hub as a daemonless detached
#  background process (optionally supervised by systemd --user / launchd when
#  `hub-service.mjs enable-boot` has registered one).
# ============================================================================
set -euo pipefail

HUB_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "  AutoQA Hub - starting..."
echo "  ============================================"

# Fast start: skip install+build when the Hub is already built. Delete
# hub/server/dist to force a rebuild (or use the Hub's in-app Update).
if [ -f "$HUB_DIR/server/dist/index.js" ]; then
  echo "  Using existing build (fast start)."
else
  pnpm -C "$HUB_DIR" install --frozen-lockfile
  pnpm -C "$HUB_DIR" run build
fi
node "$HUB_DIR/bin/hub-service.mjs" start

echo ""
echo "  AutoQA Hub is running: http://localhost:5174"
echo "    Stop:   $HUB_DIR/bin/linux-stop-hub.sh"
echo "    Status: node $HUB_DIR/bin/hub-service.mjs status"
echo ""
