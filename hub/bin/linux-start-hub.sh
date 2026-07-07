#!/usr/bin/env bash
# ============================================================================
#  AutoQA Hub — build, then start as a background service (Linux/macOS).
#
#  Thin wrapper: it builds the Hub and delegates process management to
#  hub/bin/hub-service.mjs, which starts via PM2 and AUTOMATICALLY falls back to
#  a daemonless background process when PM2 is unavailable or blocked. Force a
#  mode with HUB_PROCESS_MANAGER=none|pm2.
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
