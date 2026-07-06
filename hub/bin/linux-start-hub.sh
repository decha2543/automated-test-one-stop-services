#!/usr/bin/env bash
# ============================================================================
#  AutoQA Hub — Start as background service via PM2 (production)
#
#  Requires: Node.js, pnpm, pm2 (npm i -g pm2)
#  Tip: set HUB_HOST=0.0.0.0 in scripts/.env to expose on LAN.
#
#  This script references the pm2 app via the ecosystem file
#  (ecosystem.config.cjs) instead of by name so renaming in one place
#  (hub/ecosystem.config.cjs) is enough.
# ============================================================================

set -euo pipefail

# Navigate to hub/ directory (parent of hub/bin/).
HUB_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ECOSYSTEM="ecosystem.config.cjs"

# Pin PM2_HOME so this script's `pm2 start`/`pm2 save` writes the SAME saved
# dump the auto-start `pm2 resurrect` reads (R10.1, R10.6 parity). pm2's default
# is $HOME/.pm2; make it explicit so every pm2 context stays aligned.
export PM2_HOME="$HOME/.pm2"

echo ""
echo "  AutoQA Hub - Starting background service..."
echo "  ============================================"
echo ""

# Stop any previous instance and free the port.
cd "$HUB_DIR"
pm2 delete "$ECOSYSTEM" 2>/dev/null || true
if command -v kill-port &>/dev/null; then
    kill-port 5174 2>/dev/null || true
fi

# ----------------------------------------------------------------------------
# Install dependencies. Failing here is fatal — the build below will be
# cryptic if node_modules is incomplete, so abort early with a clear error.
# ----------------------------------------------------------------------------
echo "  Installing dependencies..."
if ! pnpm install --frozen-lockfile; then
    echo ""
    echo "  ERROR: pnpm install failed."
    echo "  Check your network and that pnpm-lock.yaml matches package.json."
    exit 1
fi

echo "  Building shared..."
if ! (cd "$HUB_DIR/shared" && pnpm run build); then
    echo "  ERROR: Shared build failed!"
    exit 1
fi

echo "  Building server..."
if ! (cd "$HUB_DIR/server" && pnpm run build); then
    echo "  ERROR: Server build failed!"
    exit 1
fi

echo "  Building client..."
if ! (cd "$HUB_DIR/client" && pnpm run build); then
    echo "  ERROR: Client build failed!"
    exit 1
fi

# Start via pm2 — single server process serves both API + static client.
cd "$HUB_DIR"
if ! pm2 start "$ECOSYSTEM"; then
    echo "  ERROR: pm2 start failed."
    exit 1
fi
pm2 save

echo ""
echo "  AutoQA Hub is running in background via PM2"
echo "  ============================================"
echo "  App: http://localhost:5174"
echo "  (Server serves both API and client on a single port)"
echo ""
echo "  Commands:"
echo "    pm2 status              - list all pm2 processes"
echo "    pm2 logs                - tail logs (all apps)"
echo "    ./linux-stop-hub.sh     - stop the AutoQA Hub"
echo ""
