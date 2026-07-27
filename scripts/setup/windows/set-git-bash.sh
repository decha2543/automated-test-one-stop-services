#!/bin/bash
# Idempotent Git Bash tweak for this workspace.
# Appends a managed block to ~/.bashrc — does NOT overwrite existing content.
# Re-running is safe: the block is replaced in place (not duplicated).

set -e

BASHRC="$HOME/.bashrc"
# Any managed block of this SHAPE is replaced — matching by shape rather than by
# an exact name means a block written by an older version of this script is
# removed too, instead of leaving the user with two managed blocks.
BLOCK_BEGIN_RE='^# >>> [A-Za-z0-9._-]*workspace begin >>>'
BLOCK_END_RE='^# <<< [A-Za-z0-9._-]*workspace end <<<'

echo "Configuring Git Bash (idempotent append to ~/.bashrc)..."

# Ensure .bashrc exists
[ -f "$BASHRC" ] || touch "$BASHRC"

# Remove any previous managed block (handles re-runs)
if grep -Eq "$BLOCK_BEGIN_RE" "$BASHRC"; then
    echo "  Replacing the existing managed block..."
    # Portable in-place delete between markers (works with Git Bash sed)
    sed -i.bak -E "/$BLOCK_BEGIN_RE/,/$BLOCK_END_RE/d" "$BASHRC"
    rm -f "$BASHRC.bak"
fi

# Append fresh managed block
cat >> "$BASHRC" <<'EOF'

# >>> autoqa-workspace begin >>>
# Managed by scripts/setup/windows/set-git-bash.sh — do not edit by hand.
export PS1='\[\033[32m\]\w\[\033[0m\] $ '
export LANG="en_US.UTF-8"
export LC_ALL="en_US.UTF-8"
export HISTCONTROL=ignoreboth:erasedups
export PROMPT_COMMAND="history -a"
shopt -s histappend
# <<< autoqa-workspace end <<<
EOF

echo "Optimizing Git config for Windows..."
git config --global core.fscache true
git config --global core.preloadindex true
git config --global gc.auto 256

echo "Done. Open a new Git Bash window for changes to take effect."
