#!/usr/bin/env bash
# ===========================================================================
#   ONE-CLICK UNINSTALLER (macOS / Linux) — removes the install AND the workspace
# ===========================================================================
#   Run it:  bash automated-test-one-stop-service_uninstaller_mac-and-linux.sh
#
#   All logic lives in scripts/setup/uninstall.mjs (--purge); this file only
#   hands over, so there is one implementation of "what gets removed" for every
#   OS and every entry point.
#
#   It cds into a temp dir first: the shell's working directory cannot be the
#   folder being deleted. `exec` replaces this shell with node, so nothing keeps
#   the script file itself busy either.
#
#   Safety is enforced by uninstall.mjs, not here: it refuses to delete the
#   folder while a test project, a brain project folder, or uncommitted /
#   unpushed git work is still in it, it asks for the folder name to be typed,
#   and it stops the Hub then verifies the port is free before deleting anything.
#   Prerequisite: node on PATH (setup installed it).
#
#   Plain uninstall, keeping the folder:  task uninstall -- --run
# ===========================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
    echo "  ERROR: node is not on PATH — cannot run the uninstaller." >&2
    exit 1
fi

echo ""
echo "  ==================================================="
echo "    UNINSTALL + DELETE WORKSPACE"
echo "    ${ROOT}"
echo "  ==================================================="
echo ""

cd "${TMPDIR:-/tmp}"
exec node "${ROOT}/scripts/setup/uninstall.mjs" --purge --run "$@"
