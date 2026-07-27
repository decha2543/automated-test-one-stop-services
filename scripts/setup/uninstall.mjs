#!/usr/bin/env node
// ============================================================================
// uninstall.mjs — undo what the one-click installer changed on THIS machine.
// ----------------------------------------------------------------------------
// Scope: only the things setup created. It never removes shared toolchains
// (volta / scoop / uv / task / node / pnpm) because other projects on the
// machine may depend on them, and it never deletes the workspace folder because
// that holds the user's own test projects. Both are listed as "kept" instead, so
// there is no doubt about what is left behind.
//
// SAFE BY DEFAULT (same convention as scripts/release.mjs):
//   no flags   → DRY RUN: prints the plan, changes nothing
//   --run      → actually remove (asks for confirmation once)
//   --yes      → skip the confirmation (for scripted/unattended removal)
//
// Usage:
//   node scripts/setup/uninstall.mjs            # show the plan
//   node scripts/setup/uninstall.mjs --run      # remove, with a confirm prompt
//   node scripts/setup/uninstall.mjs --run --yes
//
// Tunables (env): SETUP_STATE_DIR (where .setup-state.json lives),
// HUB_SHORTCUT_DIR (where the desktop shortcut was written).
// ============================================================================

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(HERE, '..', '..');
const HUB_SERVICE = path.join(WORKSPACE_ROOT, 'hub', 'bin', 'hub-service.mjs');
const STATE_FILE = path.join(process.env.SETUP_STATE_DIR || WORKSPACE_ROOT, '.setup-state.json');
const HUB_RUN_DIR = path.join(WORKSPACE_ROOT, 'hub', '.run');
const IS_WIN = process.platform === 'win32';

const DRY_RUN = !process.argv.includes('--run');
const ASSUME_YES = process.argv.includes('--yes');

/** Windows user-scope env vars setup persisted with setx. */
const WIN_USER_ENV_VARS = ['PLAYWRIGHT_BROWSERS_PATH', 'VOLTA_FEATURE_PNPM'];

/**
 * The managed block scripts/setup/windows/set-git-bash.sh appends to ~/.bashrc.
 * Matched by SHAPE, not by an exact name, so a block written by an older version
 * of that script is removed as well — the same rule the writer applies.
 */
const BASHRC_BLOCK =
  /^[ \t]*# >>> [A-Za-z0-9._-]*workspace begin >>>[\s\S]*?^[ \t]*# <<< [A-Za-z0-9._-]*workspace end <<<[ \t]*\r?\n?/gm;

const done = [];
const kept = [];
const failed = [];

/** Record an action: performed on --run, described on a dry run. */
function step(label, action) {
  if (DRY_RUN) {
    done.push(label);
    return;
  }
  try {
    const note = action();
    done.push(note ? `${label} — ${note}` : label);
  } catch (e) {
    failed.push(`${label} — ${e.message}`);
  }
}

/** Run a hub-service verb. Never throws: uninstalling must not stall on it. */
function hubService(verb) {
  if (!fs.existsSync(HUB_SERVICE)) return 'launcher not present, skipped';
  const r = spawnSync(process.execPath, [HUB_SERVICE, verb], {
    stdio: 'pipe',
    timeout: 60_000,
    encoding: 'utf8',
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').pop() || '';
  return out.trim() || `exit ${r.status ?? '?'}`;
}

/** PowerShell one-liner (no shell, so only PowerShell quoting applies). */
function powershell(script, extraEnv = {}) {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', script], {
    stdio: 'pipe',
    timeout: 30_000,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, ...extraEnv },
  });
  if (r.error) throw r.error;
  return (r.stdout || '').trim();
}

function readUserPath() {
  return powershell("[Environment]::GetEnvironmentVariable('PATH','User')");
}

/**
 * Drop the PATH entries setup appended: the user-scope bin dir it created for
 * gb.bat, and Git's bundled GNU tools dir added for cross-shell `task`.
 * Everything else in the user PATH is left untouched.
 */
function pathEntriesToDrop(userPath) {
  const userLocal = path.join(process.env.USERPROFILE || '', '.local', 'bin').toLowerCase();
  return userPath
    .split(';')
    .filter((e) => e.trim() !== '')
    .filter((e) => {
      const v = e.trim().replace(/\\+$/, '').toLowerCase();
      return v === userLocal || /\\git\\usr\\bin$/.test(v);
    });
}

/**
 * Remove the managed block(s) from ~/.bashrc, leaving the user's own lines alone.
 * Returns null when there was nothing to remove.
 */
function stripBashrcBlock(text) {
  const next = text.replace(BASHRC_BLOCK, '').replace(/\n{3,}/g, '\n\n');
  return next === text ? null : next;
}

function rmIfExists(target, { recursive = false } = {}) {
  if (!fs.existsSync(target)) return 'nothing to remove';
  fs.rmSync(target, { force: true, recursive });
  return 'removed';
}

function plan() {
  step('Stop the Hub', () => hubService('stop'));
  step('Remove the start-at-login registration', () => hubService('disable-boot'));
  step('Remove the "Test Hub" desktop shortcut', () => hubService('remove-shortcut'));
  step(`Remove the setup ledger (${STATE_FILE})`, () => rmIfExists(STATE_FILE));
  step(`Remove the Hub run/pid/log dir (${HUB_RUN_DIR})`, () =>
    rmIfExists(HUB_RUN_DIR, { recursive: true }),
  );

  if (IS_WIN) {
    const gbShim = path.join(process.env.USERPROFILE || '', '.local', 'bin', 'gb.bat');
    step(`Remove the gb.bat shim (${gbShim})`, () => rmIfExists(gbShim));

    for (const name of WIN_USER_ENV_VARS) {
      step(`Clear the user environment variable ${name}`, () => {
        powershell(`[Environment]::SetEnvironmentVariable('${name}', $null, 'User')`);
        return 'cleared';
      });
    }

    step('Remove the PATH entries setup added (user scope)', () => {
      const userPath = readUserPath();
      const drop = pathEntriesToDrop(userPath);
      if (drop.length === 0) return 'none found';
      const next = userPath
        .split(';')
        .filter((e) => e.trim() !== '' && !drop.includes(e))
        .join(';');
      powershell("[Environment]::SetEnvironmentVariable('PATH', $env:SETUP_NEW_USER_PATH, 'User')", {
        SETUP_NEW_USER_PATH: next,
      });
      return `removed ${drop.map((d) => d.trim()).join(', ')}`;
    });

    const bashrc = path.join(process.env.USERPROFILE || '', '.bashrc');
    step(`Remove the managed Git Bash block from ${bashrc}`, () => {
      if (!fs.existsSync(bashrc)) return 'no .bashrc';
      const text = fs.readFileSync(bashrc, 'utf8');
      const stripped = stripBashrcBlock(text);
      if (stripped === null) return 'block not present';
      fs.writeFileSync(bashrc, stripped, 'utf8');
      return 'block removed';
    });
  }

  kept.push('node / pnpm / uv / task and their managers (volta, scoop) — other projects may use them');
  kept.push(`the workspace folder itself (${WORKSPACE_ROOT}) — it holds your test projects`);
  kept.push('downloaded browsers under .cache/playwright-browsers — delete that folder to reclaim the space');
  kept.push('global git tweaks (core.fscache, core.preloadindex, gc.auto) — harmless, shared with other repos');
}

function report() {
  const verb = DRY_RUN ? 'Would do' : 'Done';
  console.log('');
  console.log('===================================================');
  console.log(`  ${verb}:`);
  for (const line of done) console.log(`    - ${line}`);
  if (failed.length > 0) {
    console.log('');
    console.log('  Could not finish (safe to re-run):');
    for (const line of failed) console.log(`    ! ${line}`);
  }
  console.log('');
  console.log('  Left in place on purpose:');
  for (const line of kept) console.log(`    - ${line}`);
  console.log('===================================================');
  if (DRY_RUN) {
    console.log('  This was a dry run. Re-run with --run to apply it.');
  } else {
    console.log('  Open a new terminal for the PATH change to take effect.');
  }
  console.log('');
}

/** Ask once before changing anything. Requires --yes when there is no TTY. */
async function confirm() {
  if (ASSUME_YES) return true;
  if (!process.stdin.isTTY) {
    console.error('  Not a terminal — pass --yes to confirm a non-interactive removal.');
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question('  Remove the items listed above? [y/N]: ', (a) => {
      rl.close();
      resolve(a.trim().toLowerCase());
    });
  });
  return answer === 'y' || answer === 'yes';
}

/**
 * `--selftest` — assertions for the two functions that edit something the user
 * owns (their PATH, their ~/.bashrc). Runnable without touching the machine:
 *   node scripts/setup/uninstall.mjs --selftest
 */
async function selfTest() {
  const assert = (await import('node:assert/strict')).default;
  const savedProfile = process.env.USERPROFILE;
  process.env.USERPROFILE = 'C:\\Users\\tester';

  const userPath = [
    'C:\\Users\\tester\\AppData\\Local\\Microsoft\\WindowsApps',
    'C:\\Users\\tester\\.local\\bin',
    'C:\\Program Files\\Git\\usr\\bin\\',
    'C:\\tools\\keep-me',
    'c:\\users\\tester\\.LOCAL\\Bin',
  ].join(';');
  const drop = pathEntriesToDrop(userPath).map((e) => e.trim());
  assert.deepEqual(drop, [
    'C:\\Users\\tester\\.local\\bin',
    'C:\\Program Files\\Git\\usr\\bin\\',
    'c:\\users\\tester\\.LOCAL\\Bin',
  ]);
  assert.equal(pathEntriesToDrop('C:\\tools\\keep-me;C:\\Windows').length, 0, 'keeps unrelated entries');

  const managed = (name) =>
    `export FOO=1\n\n# >>> ${name}-workspace begin >>>\nexport PS1='x'\n# <<< ${name}-workspace end <<<\nexport BAR=2\n`;
  assert.equal(
    stripBashrcBlock(managed('autoqa')),
    'export FOO=1\n\nexport BAR=2\n',
    'strips the current managed block, keeps the user lines',
  );
  assert.equal(
    stripBashrcBlock(managed('some-older-name')),
    'export FOO=1\n\nexport BAR=2\n',
    'strips a block written by an older version of the writer',
  );
  assert.equal(stripBashrcBlock('export FOO=1\n'), null, 'no block → null');

  process.env.USERPROFILE = savedProfile;
  console.log('  selftest: PATH filter + .bashrc block strip OK');
  return 0;
}

async function main() {
  if (process.argv.includes('--selftest')) return selfTest();
  console.log('===================================================');
  console.log('  UNINSTALL — Automated Test One-Stop Service');
  console.log('===================================================');
  console.log(`  Workspace: ${WORKSPACE_ROOT}`);
  console.log(DRY_RUN ? '  Mode: DRY RUN (nothing will change)' : '  Mode: REMOVE');

  if (!DRY_RUN) {
    console.log('');
    console.log('  About to remove:');
    for (const line of planPreview()) console.log(`    - ${line}`);
    if (!(await confirm())) {
      console.log('  Cancelled — nothing was changed.');
      return 0;
    }
  }

  plan();
  report();
  return failed.length > 0 ? 1 : 0;
}

/** The same list `plan()` acts on, as plain text for the confirmation prompt. */
function planPreview() {
  const items = [
    'stop the Hub and remove its start-at-login registration',
    'remove the "Test Hub" desktop shortcut',
    'remove the setup ledger and the Hub run/log folder',
  ];
  if (IS_WIN) {
    items.push('remove the gb.bat shim and the PATH entries setup added');
    items.push(`clear the user environment variables: ${WIN_USER_ENV_VARS.join(', ')}`);
    items.push('remove the managed Git Bash block from ~/.bashrc');
  }
  items.push('KEEP node/pnpm/uv/task, volta/scoop, and the workspace folder');
  return items;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`  [error] ${e.message}`);
    process.exit(1);
  });
