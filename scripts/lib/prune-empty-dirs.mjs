#!/usr/bin/env node
// scripts/lib/prune-empty-dirs.mjs
//
// Recursively delete empty directories under <dir>, bottom-up (including <dir>
// itself if it ends up empty). Cross-platform, Node-core-only replacement for
// the GNU-only `find <dir> -type d -empty -delete` used by the k6 and
// robot-framework Taskfiles — `node` is a Core tool always on PATH, so this
// runs identically from cmd, PowerShell, and Git Bash without depending on a
// coreutils `find`.
//
// Best-effort by design: a missing root and per-entry errors are swallowed
// (mirrors the `2>/dev/null` on the original recipe), and a directory that
// still holds files or non-empty subdirs is left untouched.
import { readdirSync, rmdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Remove empty directories bottom-up. A directory counts as removable only when
 * every child is itself a directory that was removed (no files, no symlinks, no
 * surviving subdirs) — matching GNU `find -type d -empty`.
 * @param {string} dir absolute or relative directory path
 * @returns {boolean} true when `dir` was removed
 */
export function pruneEmptyDirs(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false; // missing / not a directory — nothing to prune
  }
  let removedAll = true;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!pruneEmptyDirs(`${dir}/${entry.name}`)) removedAll = false;
    } else {
      removedAll = false; // a file or symlink keeps the directory non-empty
    }
  }
  if (!removedAll) return false;
  try {
    rmdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: prune-empty-dirs.mjs <dir>');
    process.exit(2);
  }
  pruneEmptyDirs(target);
}
