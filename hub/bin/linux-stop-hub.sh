#!/usr/bin/env bash
# ============================================================================
#  AutoQA Hub — stop the background service (Linux/macOS).
#  Delegates to hub/bin/hub-service.mjs, which stops the daemonless instance
#  (or the OS supervisor when one is registered) and frees the port.
# ============================================================================
set +e

HUB_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Stopping AutoQA Hub..."
node "$HUB_DIR/bin/hub-service.mjs" stop
echo "AutoQA Hub stopped."
