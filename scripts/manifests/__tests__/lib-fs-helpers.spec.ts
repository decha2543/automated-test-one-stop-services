// scripts/manifests/__tests__/lib-fs-helpers.spec.ts
//
// Runnable checks for the cross-platform Node FS helpers under scripts/lib/ that
// replaced the GNU-only `find` invocations in the Taskfiles:
//   * prune-empty-dirs.mjs  — `find <dir> -type d -empty -delete`
//   * rm-matching-dirs.mjs  — `find . -prune ... -name X -exec rm -rf {} +`
//   * list-git-dirs.mjs     — `find <root> -name .git -type d`
//
// Each helper carries non-trivial recursive logic, so each gets a check that
// fails if the behaviour breaks. Pure example tests over a real temp tree — no
// fixtures, no framework beyond vitest.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listGitDirs } from '../../lib/list-git-dirs.mjs';
import { pruneEmptyDirs } from '../../lib/prune-empty-dirs.mjs';
import { rmMatchingDirs } from '../../lib/rm-matching-dirs.mjs';

let root: string;

/** mkdir -p + write a file (creating parents). */
function touch(...segments: string[]): void {
  const file = join(root, ...segments);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, 'x');
}
/** mkdir -p a directory under root. */
function dir(...segments: string[]): void {
  mkdirSync(join(root, ...segments), { recursive: true });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kiro-fs-helpers-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('prune-empty-dirs: removes only empty directories, bottom-up', () => {
  it('removes empty + recursively-empty dirs, keeps any dir holding a file', () => {
    dir('empty1');
    dir('empty2', 'emptynested');
    dir('onlyempties', 'a');
    dir('onlyempties', 'b');
    touch('keep', 'file.txt');
    touch('keep2', 'sub', 'file.txt');

    pruneEmptyDirs(root);

    // empties gone (including parents that became empty)
    expect(existsSync(join(root, 'empty1'))).toBe(false);
    expect(existsSync(join(root, 'empty2'))).toBe(false);
    expect(existsSync(join(root, 'onlyempties'))).toBe(false);
    // dirs with content survive, files untouched
    expect(existsSync(join(root, 'keep', 'file.txt'))).toBe(true);
    expect(existsSync(join(root, 'keep2', 'sub', 'file.txt'))).toBe(true);
    // root itself survives because it still has non-empty children
    expect(existsSync(root)).toBe(true);
  });

  it('removes the root itself when the whole tree is empty', () => {
    dir('a', 'b', 'c');
    const removed = pruneEmptyDirs(root);
    expect(removed).toBe(true);
    expect(existsSync(root)).toBe(false);
  });
});

describe('rm-matching-dirs: removes named dirs, honours the prune scope', () => {
  it('removes matching dirs at any depth but never inside a pruned dir', () => {
    touch('a', 'test-results', 'r.txt');
    touch('a', 'playwright-report', 'index.html');
    touch('a', 'node_modules', 'dep.txt'); // pruned by name → survives
    touch('.venv', 'test-results', 'x.txt'); // inside pruned .venv → survives
    touch('node_modules', 'test-results', 'y.txt'); // inside pruned node_modules → survives
    touch('keep', 'data.txt');

    const removed = rmMatchingDirs(
      root,
      new Set(['test-results', 'playwright-report']),
      new Set(['.venv', 'node_modules']),
    );

    expect(existsSync(join(root, 'a', 'test-results'))).toBe(false);
    expect(existsSync(join(root, 'a', 'playwright-report'))).toBe(false);
    // pruned dirs and their contents are left entirely alone
    expect(existsSync(join(root, 'a', 'node_modules', 'dep.txt'))).toBe(true);
    expect(existsSync(join(root, '.venv', 'test-results', 'x.txt'))).toBe(true);
    expect(existsSync(join(root, 'node_modules', 'test-results', 'y.txt'))).toBe(true);
    expect(existsSync(join(root, 'keep', 'data.txt'))).toBe(true);
    expect(removed.length).toBe(2);
  });

  it('clean-modules scope: removes node_modules everywhere except inside .venv', () => {
    touch('node_modules', 'a.txt');
    touch('pkg', 'node_modules', 'b.txt');
    touch('.venv', 'node_modules', 'c.txt'); // .venv pruned → survives

    const removed = rmMatchingDirs(root, new Set(['node_modules']), new Set(['.venv']));

    expect(existsSync(join(root, 'node_modules'))).toBe(false);
    expect(existsSync(join(root, 'pkg', 'node_modules'))).toBe(false);
    expect(existsSync(join(root, '.venv', 'node_modules', 'c.txt'))).toBe(true);
    expect(removed.length).toBe(2);
  });
});

describe('list-git-dirs: finds .git dirs, skips deps, emits forward slashes', () => {
  it('lists every project .git dir and skips node_modules/.venv', () => {
    dir('proj1', '.git');
    dir('proj2', 'nested', '.git');
    dir('node_modules', 'dep', '.git'); // skipped
    dir('.venv', 'pkg', '.git'); // skipped
    dir('nogit');

    const found = listGitDirs(root).sort();

    expect(found).toContain(`${root}/proj1/.git`);
    expect(found).toContain(`${root}/proj2/nested/.git`);
    expect(found.some((p) => p.includes('node_modules'))).toBe(false);
    expect(found.some((p) => p.includes('.venv'))).toBe(false);
    expect(found.length).toBe(2);
    // helper-added separators are forward slashes regardless of OS (the root
    // prefix passed in is whatever the caller gave; `pull` passes "tools").
    const rels = found.map((p) => p.slice(root.length));
    expect(rels.every((r) => !r.includes('\\'))).toBe(true);
  });
});
