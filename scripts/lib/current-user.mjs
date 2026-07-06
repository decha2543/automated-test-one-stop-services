#!/usr/bin/env node
// scripts/lib/current-user.mjs
//
// Print the current OS username, BARE (no domain prefix), consistently across
// cmd, PowerShell, and Git Bash. Replaces `whoami` in the root Taskfile env
// block: on Windows the native System32 `whoami.exe` (which wins for a bare
// `whoami` when Git's usr\bin is merely appended to PATH) prints
// `DOMAIN\username` — a backslash that would otherwise split the value. We keep
// it bare so CURRENT_USER is a clean, stable login name on every OS/shell.
//
// CURRENT_USER is NO LONGER part of the output-dir path (runs are grouped by
// date only, not by tester). It is retained purely as an audit field — the
// "executed by" column in the Google Sheet usage log
// (scripts/third-party/google/google-sheet-usage-log.ts). `os.userInfo().username`
// gives the bare login name everywhere, and `node` is a Core tool always on PATH.
import os from 'node:os';

process.stdout.write(os.userInfo().username);
