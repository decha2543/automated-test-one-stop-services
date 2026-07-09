// @ts-check
/**
 * Cross-platform install & provisioning SMOKE checks (Task 18, spec
 * `install-and-provisioning-overhaul`).
 *
 * Covers the BEHAVIORAL clean-environment outcomes that only a real,
 * already-provisioned machine/VM can demonstrate:
 *   • 18.1 — Core-install smoke ............ R1.1, R1.2, R1.3, R2.2
 *   • 18.2 — opt-in / boot-survival smoke .. R3.3, R3.4, R10.3-R10.6, R11.1, R11.2
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHAT THIS PROVES  (and why it is NOT in the default unit pass)
 * ─────────────────────────────────────────────────────────────────────────
 * These assertions describe the *end state* of a clean-OS `Installer` run:
 * the four Core tools resolve on PATH, the Hub is online (under ANY supervisor),
 * installs stayed user-scope, the opt-in Android SDK landed, an OS-appropriate
 * daemon-free boot auto-start (Windows logon task / systemd --user / launchd)
 * is registered, and (Layer D) `task` runs cross-shell. NONE of that can be
 * observed without first running
 * a *destructive* provisioning flow on a throwaway VM/CI runner — installing
 * toolchains, starting the Hub, installing Android. That is unsafe in a dev
 * checkout and impossible in the unit-test sandbox (no clean VM, no Docker).
 *
 * So every live-machine check below is GUARDED: it SKIPS (never fails) unless
 * `KIRO_SMOKE=1` is set. A normal `node --test` run over the suite (the
 * `.spec.mjs` glob) therefore reports these as skipped and stays green —
 * authoring them never mutates the machine and never breaks the default suite.
 *
 *  HOW TO RUN ON A CLEAN VM / CI  (per the design "Smoke / integration tests"):
 *    1. Provision a clean Windows / Ubuntu / macOS VM and run the real
 *       Installer (`scripts/setup/setup-windows.bat` | `setup-linux.sh`).
 *    2. KIRO_SMOKE=1 node --test "scripts/__tests__/install-provisioning-smoke.spec.mjs"
 *    3. Opt-in jobs need their own flag AFTER running the matching command:
 *         • Android  — `task setup-android`,           then KIRO_SMOKE_ANDROID=1
 *         • Layer D  — enable shell-decoupling on PATH, then KIRO_SMOKE_LAYERD=1
 *
 *  RELATION TO THE STRUCTURAL SUITE (do NOT duplicate it here):
 *    `setup-bootstrap-integration.spec.mjs` already greps the REAL installer
 *    scripts for the *structural* contracts (Core step set, STEP_ORDER, retry
 *    bounds, user-scope wording, ledger idempotency). Task 18 is purely the
 *    BEHAVIORAL counterpart — the runtime outcome a VM shows — so it asserts
 *    against the live environment, not against script text.
 *
 *  ponytail ceiling: clean-OS coverage is CI-smoke-only; a deeper matrix
 *    (older Windows builds, non-apt Linux) is a manual checklist, not code.
 *    Two values below are forward-references to not-yet-implemented tasks and
 *    must be kept in lock-step when those land:
 *      • HUB_TASK_NAME ← the logon Scheduled Task `hub-service.mjs enable-boot` registers.
 *      • the Layer D PATH coreutils ← exposed by Task 17 (optional, off by default).
 *
 * No `__dirname`/REPO_ROOT is computed: every probe targets the live
 * environment (PATH, $HOME, $ANDROID_HOME, schtasks) — not a repo file —
 * so there is nothing to resolve relative to this file or to cwd.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// ── Live-environment facts (sourced from design.md, verified) ──────────────
/** Core_Tool_Set — R4.1 (k6 is no longer Core; it self-provisions by folder). */
const CORE_TOOLS = ['node', 'pnpm', 'uv', 'task'];
/** Hub health endpoint — manager-agnostic "is the Hub up" probe. The Hub may run
 *  as a daemonless background process or under systemd/launchd, so we probe the
 *  loopback port, not a specific supervisor. */
const HUB_HEALTH_URL = `http://127.0.0.1:${process.env.HUB_PORT || '5174'}/api/health`;
/** Windows logon Scheduled Task registered by `hub-service.mjs enable-boot`.
 *  Keep identical to TASK_NAME in hub/bin/hub-service.mjs. */
const HUB_TASK_NAME = 'AutoQA Hub';
/** The exact external commands the Taskfiles invoke — R11.1 (verbatim list). */
const TASKFILE_COREUTILS = [
  'date', 'whoami', 'find', 'sed', 'cp', 'mv', 'mkdir', 'rm',
  'basename', 'dirname', 'cat', 'tee', 'seq', 'sleep', 'head', 'git',
];

const SMOKE = process.env.KIRO_SMOKE === '1';
const IS_WIN = process.platform === 'win32';
const SMOKE_OFF =
  'live-VM smoke — set KIRO_SMOKE=1 on a provisioned clean VM/CI to run ' +
  '(intentionally skipped in the default unit pass; never mutates the machine)';

/**
 * Per-test skip resolver. Returns `false` to RUN, or a reason string to SKIP.
 * The base gate is `KIRO_SMOKE`; `extraReason` layers an additional condition
 * (platform / opt-in flag) that only applies once smoke mode is on.
 * @param {string | false} [extraReason]
 * @returns {string | false}
 */
function smokeSkip(extraReason) {
  if (!SMOKE) return SMOKE_OFF;
  return extraReason ?? false;
}

/**
 * Resolve a command's first PATH location, or null if unresolved.
 * Uses the OS resolver so `.cmd`/`.exe` shims are honoured on Windows.
 * @param {string} cmd
 * @returns {string | null}
 */
function resolveOnPath(cmd) {
  const finder = IS_WIN ? 'where' : 'which';
  const r = spawnSync(finder, [cmd], { encoding: 'utf8', timeout: 15_000 });
  if (r.status !== 0 || typeof r.stdout !== 'string') return null;
  const first = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  return first ?? null;
}

/**
 * True when a resolved binary path sits under an admin-only / system root that
 * a user-scope install (R2.2) must avoid. User-writable prefixes that merely
 * *look* like system paths (`/usr/local`, `/opt/homebrew`, Volta/`~/.local`
 * shims) are intentionally allowed — they need no elevation.
 * @param {string} p
 * @returns {boolean}
 */
function isAdminOnlyPath(p) {
  if (IS_WIN) {
    const lower = p.toLowerCase();
    return lower.startsWith('c:\\windows') || lower.startsWith('c:\\program files');
  }
  return ['/usr/bin/', '/usr/sbin/', '/bin/', '/sbin/'].some((root) => p.startsWith(root));
}

// ===========================================================================
//  18.1 — Core-install smoke (R1.1, R1.2, R1.3, R2.2)
// ===========================================================================
describe('18.1 Core-install smoke (live VM — KIRO_SMOKE=1)', () => {
  it('the four Core tools resolve and run on PATH (R1.1, R1.3)', { skip: smokeSkip() }, () => {
    // R1.1 every Core member installed; R1.3 each reported present on PATH.
    // `shell:true` so Windows `.cmd`/`.bat` shims (pnpm, task) resolve too.
    for (const tool of CORE_TOOLS) {
      const r = spawnSync(`${tool} --version`, { shell: true, encoding: 'utf8', timeout: 30_000 });
      assert.equal(r.error, undefined, `spawning "${tool}" failed: ${r.error?.message}`);
      assert.equal(r.status, 0, `"${tool} --version" must exit 0 (present on PATH) — got ${r.status}`);
    }
  });

  it('the Hub is online (health endpoint responds) (R1.2)', { skip: smokeSkip() }, async () => {
    // R1.2: a running Hub is the success criterion, independent of HOW it is
    // supervised (daemonless / systemd / launchd). The manager-agnostic
    // probe is the health endpoint on the loopback port.
    const res = await fetch(HUB_HEALTH_URL).catch(() => null);
    assert.ok(res?.ok, `Hub health endpoint must respond 2xx at ${HUB_HEALTH_URL} (R1.2)`);
  });

  it('Core tools held user scope — no admin-only paths (R2.2)', { skip: smokeSkip() }, () => {
    // R2.2: where a member CAN be user-scoped, it IS — so no Core binary may
    // resolve under a system root that needs elevation.
    for (const tool of CORE_TOOLS) {
      const resolved = resolveOnPath(tool);
      assert.ok(resolved, `Core tool "${tool}" must resolve on PATH`);
      assert.ok(
        !isAdminOnlyPath(resolved),
        `"${tool}" resolved to an admin-only path (R2.2 user-scope violated): ${resolved}`,
      );
    }
  });
});

// ===========================================================================
//  18.2 — opt-in & boot-survival smoke (R3.3, R3.4, R10.3-R10.6, R11.1, R11.2)
// ===========================================================================
describe('18.2 opt-in & boot-survival smoke (live VM — KIRO_SMOKE=1)', () => {
  it(
    'Android SDK + emulator present after `task setup-android` (R3.3, R3.4)',
    { skip: smokeSkip(process.env.KIRO_SMOKE_ANDROID === '1'
        ? false
        : 'opt-in: run `task setup-android`, then set KIRO_SMOKE_ANDROID=1') },
    () => {
      // R3.3 the opt-in path actually INSTALLS (not just prints guidance);
      // R3.4 equivalent components on every platform → assert the SDK layout
      // exists regardless of OS (path differs only by executable suffix).
      const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
      assert.ok(androidHome, 'ANDROID_HOME / ANDROID_SDK_ROOT must be set after setup-android');
      assert.ok(fs.existsSync(androidHome), `Android SDK dir must exist: ${androidHome}`);
      const sdkmanager = path.join(
        androidHome, 'cmdline-tools', 'latest', 'bin', IS_WIN ? 'sdkmanager.bat' : 'sdkmanager',
      );
      const emulator = path.join(androidHome, 'emulator', IS_WIN ? 'emulator.exe' : 'emulator');
      assert.ok(fs.existsSync(sdkmanager), `SDK manager must be installed (R3.3): ${sdkmanager}`);
      assert.ok(fs.existsSync(emulator), `emulator must be installed (R3.3): ${emulator}`);
    },
  );

  it(
    'Windows logon Scheduled Task starts the Hub, no daemon required (R10.3, R10.4)',
    { skip: smokeSkip(IS_WIN ? false : 'Windows-only: logon Scheduled Task (R10.3/R10.4)') },
    () => {
      // R10.3 the Hub auto-starts on login → the user-scope logon task must exist.
      const q = spawnSync('schtasks', ['/query', '/tn', HUB_TASK_NAME], {
        encoding: 'utf8',
        timeout: 30_000,
      });
      assert.equal(q.status, 0, `logon task "${HUB_TASK_NAME}" must exist (R10.3)`);
      // R10.4 node must resolve in the bare logon context → the task action is
      // hub-autostart.cmd, which seeds the Volta shim PATH before running node.
      const xml = spawnSync('schtasks', ['/query', '/tn', HUB_TASK_NAME, '/xml'], {
        encoding: 'utf8',
        timeout: 30_000,
      });
      assert.match(
        xml.stdout,
        /hub-autostart\.cmd/i,
        'auto-start action must be hub-autostart.cmd (R10.4)',
      );
    },
  );

  it('an OS-appropriate boot auto-start is registered (R10.6)', { skip: smokeSkip() }, () => {
    // R10.6 a daemon-free, OS-appropriate auto-start exists on EVERY platform,
    // all registered by `hub-service.mjs enable-boot`:
    //   Windows → user-scope logon Scheduled Task "AutoQA Hub"
    //   Linux   → systemd --user unit ~/.config/systemd/user/autoqa-hub.service
    //   macOS   → launchd agent ~/Library/LaunchAgents/dev.autoqa.hub.plist
    if (IS_WIN) {
      const q = spawnSync('schtasks', ['/query', '/tn', HUB_TASK_NAME], {
        encoding: 'utf8',
        timeout: 30_000,
      });
      assert.equal(q.status, 0, `logon task "${HUB_TASK_NAME}" must exist (R10.6)`);
    } else if (process.platform === 'darwin') {
      const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', 'dev.autoqa.hub.plist');
      assert.ok(fs.existsSync(plist), `launchd agent must exist (R10.6): ${plist}`);
    } else {
      const unit = path.join(
        process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
        'systemd',
        'user',
        'autoqa-hub.service',
      );
      assert.ok(fs.existsSync(unit), `systemd --user unit must exist (R10.6): ${unit}`);
    }
  });

  it(
    'coreutils resolve and `task` runs cross-shell with Layer D on (R11.1, R11.2)',
    { skip: smokeSkip(
        IS_WIN
          ? (process.env.KIRO_SMOKE_LAYERD === '1'
              ? false
              : 'opt-in Layer D: enable shell-decoupling on PATH, then set KIRO_SMOKE_LAYERD=1')
          : 'Windows-only: Layer D shell decoupling (POSIX already has coreutils)') },
    () => {
      // R11.1: every external command the Taskfiles call must resolve on PATH.
      // PATH is shared across cmd/PowerShell/Git Bash, so resolving each once
      // proves availability for all three shells.
      for (const util of TASKFILE_COREUTILS) {
        assert.ok(resolveOnPath(util), `Taskfile coreutil "${util}" must resolve on PATH (R11.1)`);
      }
      // R11.2: the `task` runner itself must execute from each shell. We use the
      // read-only `task --list-all` as the proxy — running the full mutating
      // `task setup` from three shells is out of scope here (ponytail ceiling:
      // it provisions the machine; the structural suite + the manual clean-VM
      // checklist cover the actual setup run).
      /** @type {[string, string[]][]} */
      const perShell = [
        ['cmd', ['/d', '/c', 'task --list-all']],
        ['powershell', ['-NoProfile', '-Command', 'task --list-all']],
        ['bash', ['-lc', 'task --list-all']],
      ];
      for (const [sh, args] of perShell) {
        const r = spawnSync(sh, args, { encoding: 'utf8', timeout: 60_000 });
        assert.equal(r.error, undefined, `task must be runnable from ${sh} (R11.2): ${r.error?.message}`);
        assert.equal(r.status, 0, `"task --list-all" must exit 0 under ${sh} (R11.2) — got ${r.status}`);
      }
    },
  );
});
