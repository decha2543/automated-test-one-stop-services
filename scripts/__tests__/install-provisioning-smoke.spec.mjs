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
 * the five Core tools resolve on PATH, the Hub is online under pm2, installs
 * stayed user-scope, the opt-in Android SDK landed, the Windows logon
 * Scheduled Task + saved pm2 dump exist so the Hub resurrects, and (Layer D)
 * `task` runs cross-shell. NONE of that can be observed without first running
 * a *destructive* provisioning flow on a throwaway VM/CI runner — installing
 * toolchains, starting pm2, installing Android. That is unsafe in a dev
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
 *      • RESURRECT_TASK_NAME ← the Scheduled Task that Task 15 registers.
 *      • the Layer D PATH coreutils ← exposed by Task 17 (optional, off by default).
 *
 * No `__dirname`/REPO_ROOT is computed: every probe targets the live
 * environment (PATH, $HOME, $ANDROID_HOME, pm2, schtasks) — not a repo file —
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
const CORE_TOOLS = ['node', 'pnpm', 'uv', 'task', 'pm2'];
/** pm2 application name — `hub/ecosystem.config.cjs` app id (design Source-grounding). */
const HUB_PM2_APP = 'auto-qa-hub-service';
/** Windows logon Scheduled Task registered by Task 15 (D4-A). Forward-reference:
 *  keep identical to the `schtasks /create /tn` name that task uses. */
const RESURRECT_TASK_NAME = 'AutoQA Hub Resurrect';
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

/** The pinned PM2_HOME for the current platform (design C8). */
function pm2Home() {
  return process.env.PM2_HOME || path.join(os.homedir(), '.pm2');
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
  it('the five Core tools resolve and run on PATH (R1.1, R1.3)', { skip: smokeSkip() }, () => {
    // R1.1 every Core member installed; R1.3 each reported present on PATH.
    // `shell:true` so Windows `.cmd`/`.bat` shims (pnpm, task) resolve too.
    for (const tool of CORE_TOOLS) {
      const r = spawnSync(`${tool} --version`, { shell: true, encoding: 'utf8', timeout: 30_000 });
      assert.equal(r.error, undefined, `spawning "${tool}" failed: ${r.error?.message}`);
      assert.equal(r.status, 0, `"${tool} --version" must exit 0 (present on PATH) — got ${r.status}`);
    }
  });

  it('the Hub is online via pm2 (R1.2)', { skip: smokeSkip() }, () => {
    // R1.2: a running Hub process is the success criterion (network reachability
    // is explicitly NOT). `pm2 jlist` is the authoritative probe; an HTTP GET of
    // the Hub port (http://localhost:5174) is an optional extra, deliberately
    // omitted so a firewalled-but-running Hub still passes per R1.2.
    const r = spawnSync('pm2', ['jlist'], { shell: true, encoding: 'utf8', timeout: 30_000 });
    assert.equal(r.status, 0, `"pm2 jlist" must exit 0 — got ${r.status}\n${r.stderr}`);
    // pm2 may print an update banner before the JSON array — slice from the first '['.
    const jsonStart = r.stdout.indexOf('[');
    assert.ok(jsonStart >= 0, 'pm2 jlist must emit a JSON array');
    const list = JSON.parse(r.stdout.slice(jsonStart));
    const hub = Array.isArray(list) ? list.find((p) => p?.name === HUB_PM2_APP) : undefined;
    assert.ok(hub, `pm2 must have the Hub app "${HUB_PM2_APP}" registered`);
    assert.equal(hub.pm2_env?.status, 'online', `"${HUB_PM2_APP}" must be online (R1.2)`);
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
    'Hub resurrect Scheduled Task + saved dump exist on Windows login (R10.3, R10.4)',
    { skip: smokeSkip(IS_WIN ? false : 'Windows-only: pm2 logon Scheduled Task (R10.3/R10.4)') },
    () => {
      // R10.3 the saved Hub resurrects on login → the logon Scheduled Task must
      // exist and a saved process dump must be present to resurrect FROM.
      const q = spawnSync('schtasks', ['/query', '/tn', RESURRECT_TASK_NAME], {
        encoding: 'utf8',
        timeout: 30_000,
      });
      assert.equal(q.status, 0, `logon task "${RESURRECT_TASK_NAME}" must exist (R10.3)`);
      const dump = path.join(pm2Home(), 'dump.pm2');
      assert.ok(fs.existsSync(dump), `a saved pm2 dump must exist to resurrect from (R10.2/R10.3): ${dump}`);
      // R10.4 pm2 + node must be on PATH in the auto-start context → the task's
      // action must pin PM2_HOME and put node/Volta on PATH before calling pm2.
      const xml = spawnSync('schtasks', ['/query', '/tn', RESURRECT_TASK_NAME, '/xml'], {
        encoding: 'utf8',
        timeout: 30_000,
      });
      assert.match(xml.stdout, /\.pm2/i, 'auto-start action must reference PM2_HOME (R10.4)');
      assert.match(xml.stdout, /volta|node/i, 'auto-start action must put node/Volta on PATH (R10.4)');
    },
  );

  it('pm2 has a saved, resurrectable state under the pinned PM2_HOME (R10.6)', { skip: smokeSkip() }, () => {
    // R10.6 an OS-appropriate auto-start exists on EVERY platform. The portable,
    // non-fragile evidence is the saved process dump under the single pinned
    // PM2_HOME (Windows: %USERPROFILE%\.pm2 — posix: $HOME/.pm2). The OS wiring
    // that consumes it (Windows Scheduled Task ↑, posix systemd/launchd `pm2
    // startup`) is asserted on Windows above; on posix the unit registration is
    // verified by the manual clean-OS checklist (ponytail ceiling), not probed
    // here to avoid brittle systemd-vs-launchd branching.
    //
    // R10.5 (pre-login boot survival) is the DOCUMENTED optional escalation
    // (D4-B: nssm / node-windows service) — only required WHERE explicitly
    // requested, so it is intentionally NOT asserted by the default smoke.
    const dump = path.join(pm2Home(), 'dump.pm2');
    assert.ok(
      fs.existsSync(dump),
      `a saved pm2 process list must exist under the pinned PM2_HOME (R10.6): ${dump}`,
    );
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
