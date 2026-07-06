#!/usr/bin/env bash
# ============================================================================
#  AutoQA Hub - Stop background PM2 service.
#
#  Uses the ecosystem file rather than the pm2 app name so renaming the
#  app only requires editing hub/ecosystem.config.cjs.
# ============================================================================

set +e

HUB_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ECOSYSTEM="ecosystem.config.cjs"

# Pin PM2_HOME to the SAME dir start/save/resurrect use so `pm2 stop`/
# `pm2 delete` target the right daemon (R10.1, R10.6 parity). pm2's default
# is $HOME/.pm2.
export PM2_HOME="$HOME/.pm2"

echo "Stopping AutoQA Hub..."
cd "$HUB_DIR" 2>/dev/null || true

pm2 stop "$ECOSYSTEM" 2>/dev/null
pm2 delete "$ECOSYSTEM" 2>/dev/null

# Free the API/UI port in case anything else grabbed it.
if command -v kill-port &>/dev/null; then
    kill-port 5174 2>/dev/null
fi

echo "AutoQA Hub stopped."
