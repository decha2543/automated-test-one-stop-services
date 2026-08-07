// @ts-check
/**
 * Gates on the uninstaller's `--purge` path (scripts/setup/uninstall.mjs).
 *
 * Mirrors the script's own `--selftest` into the automated suite (`node --test`)
 * the same way `eval-test-quality.spec.mjs` does, because a flag nobody runs is
 * not a gate. This is the most destructive code in the repo — it deletes the
 * whole workspace folder — so the refusal path must fail CI, not a manual run.
 *
 * `uninstall.mjs` calls `main()` at module scope, so it cannot be imported: every
 * case here spawns it as a child process instead. The workspace it acts on is
 * derived from the script's own location, so the cases that let it actually
 * delete something COPY the two files it needs into a throwaway fixture tree and
 * run that copy. The real workspace is never a target.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const REAL_SCRIPT = path.join(REPO_ROOT, 'scripts', 'setup', 'uninstall.mjs');

/** Run the uninstaller (or a fixture copy of it) and capture its report. */
function run(script, args, env = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, ...env },
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

/**
 * A throwaway workspace holding just enough for the gates to be meaningful: the
 * uninstaller, the git-dir helper it imports, and whatever project folders the
 * case wants. No `.git` anywhere, so the unsaved-work gate passes and the case
 * under test is the only thing that can block.
 * @param {string[][]} projectDirs path segments to create under the fixture
 */
function makeFixtureWorkspace(projectDirs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-gate-'));
  fs.mkdirSync(path.join(root, 'scripts', 'setup'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(REAL_SCRIPT, path.join(root, 'scripts', 'setup', 'uninstall.mjs'));
  fs.copyFileSync(
    path.join(REPO_ROOT, 'scripts', 'lib', 'list-git-dirs.mjs'),
    path.join(root, 'scripts', 'lib', 'list-git-dirs.mjs'),
  );
  for (const segments of projectDirs) {
    fs.mkdirSync(path.join(root, ...segments), { recursive: true });
  }
  return { root, script: path.join(root, 'scripts', 'setup', 'uninstall.mjs') };
}

test('--selftest passes: PATH filter, .bashrc strip, and the purge gate helpers', () => {
  const { code, out } = run(REAL_SCRIPT, ['--selftest']);
  assert.equal(code, 0, out);
  assert.match(out, /purge gates OK/);
});

test('a dry run of the real workspace never reports the folder as kept when purging', () => {
  const { out } = run(REAL_SCRIPT, ['--purge']);
  // Either it refuses (this repo has projects) or it plans the delete — but it
  // must never claim the folder is "left in place on purpose" under --purge.
  assert.ok(/PURGE REFUSED/.test(out) || /delete the workspace folder itself/.test(out), out);
  assert.doesNotMatch(out, /the workspace folder itself \(.*\) — it holds your test projects/);
});

test('purge refuses while a user test project is still present, and changes nothing', () => {
  const { root, script } = makeFixtureWorkspace([
    ['tools', 'playwright', 'projects', 'web', 'my-project'],
  ]);
  try {
    const { code, out } = run(script, ['--purge', '--run', '--yes']);
    assert.equal(code, 2, out);
    assert.match(out, /PURGE REFUSED/);
    assert.match(out, /tools\/playwright\/projects\/web\/my-project/);
    assert.ok(fs.existsSync(root), 'the workspace must still be there after a refusal');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('purge refuses while a project brain folder is still present', () => {
  const { root, script } = makeFixtureWorkspace([['brain', 'projects', 'my-project']]);
  try {
    const { code, out } = run(script, ['--purge', '--run', '--yes']);
    assert.equal(code, 2, out);
    assert.match(out, /brain\/projects\/my-project/);
    assert.ok(fs.existsSync(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the folder is not deleted while the Hub still answers on its port', (t) => {
  // POSIX only, same reason as the case below: `--run` reaches the Windows
  // machine-state steps before this guard is evaluated.
  if (process.platform === 'win32') {
    t.skip('skipped on Windows: --run mutates user PATH/env outside the fixture');
    return;
  }
  const { root, script } = makeFixtureWorkspace([['brain', 'projects', '_workspace']]);
  try {
    // A stand-in launcher whose `status` exits 0 — i.e. "the Hub is up". The real
    // one answers that way while the port is listening.
    fs.mkdirSync(path.join(root, 'hub', 'bin'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'hub', 'bin', 'hub-service.mjs'),
      'process.exit(process.argv[2] === "status" ? 0 : 0);\n',
      'utf8',
    );
    const { code, out } = run(script, ['--purge', '--run', '--yes']);
    assert.equal(code, 1, out);
    assert.match(out, /Hub is still running/);
    assert.ok(fs.existsSync(root), 'a running Hub must leave the workspace untouched');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('shipped templates alone do not block, and the purge really deletes the folder', (t) => {
  // POSIX only. On Windows the uninstaller's `--run` path also edits the calling
  // user's PATH, env vars and ~/.bashrc — real machine state that a test must not
  // touch. CI runs ubuntu-latest, so the delete path stays covered where it counts.
  if (process.platform === 'win32') {
    t.skip('skipped on Windows: --run mutates user PATH/env outside the fixture');
    return;
  }
  const { root, script } = makeFixtureWorkspace([
    ['tools', 'playwright', 'projects', 'web', 'playwright-web-template-example'],
    ['brain', 'projects', '_workspace'],
    ['brain', 'projects', 'project-template-example'],
  ]);
  let deleted = false;
  try {
    const { code, out } = run(script, ['--purge', '--run', '--yes']);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /PURGE REFUSED/);
    assert.equal(fs.existsSync(root), false, 'the fixture workspace should be gone');
    deleted = true;
  } finally {
    if (!deleted) fs.rmSync(root, { recursive: true, force: true });
  }
});
