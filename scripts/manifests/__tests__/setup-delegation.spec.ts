// scripts/manifests/__tests__/setup-delegation.spec.ts
//
// Example tests for Task 6 of the install-and-provisioning-overhaul spec
// (root Setup_Task delegation loop + central-hardcode removal, C1):
//  - The root `setup` target no longer runs a hardcoded `playwright install`
//    (R5.1) — provisioning is delegated to each tool's own `setup` task.
//  - The setup path sets no `NODE_TLS_REJECT_UNAUTHORIZED=0` default; TLS
//    validation is never disabled by default (R12.5).
//  - The target delegates via the shared planner and runs each tool's `setup`
//    by taskfile path (folder-presence delegation, R5.5 / R6.1).
//  - `gatherToolSetupFacts` + `planToolSetup` reflect folder-presence end to end.
//
// Validates: Requirements 5.1, 12.5 (with R5.5 / R6.1 delegation guards)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gatherToolSetupFacts, planToolSetup } from '../setup-planner.js';
import { makeTmpDir, rmTmpDir } from './_helpers.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const TASKFILE = fs.readFileSync(path.join(REPO_ROOT, 'Taskfile.yml'), 'utf8');

/**
 * Slice out a single top-level task target body (from its `  <name>:` header up
 * to the next two-space-indented task header), so assertions about the `setup`
 * target never bleed into a sibling like `setup-android`.
 */
function taskBody(taskfile: string, name: string): string {
  const start = taskfile.indexOf(`\n  ${name}:`);
  if (start < 0) throw new Error(`task ${name} not found in Taskfile`);
  const rest = taskfile.slice(start + 1);
  const nextHeader = rest.slice(`  ${name}:`.length).search(/\n {2}[a-z0-9-]+:/i);
  return nextHeader < 0 ? rest : rest.slice(0, `  ${name}:`.length + nextHeader);
}

describe('Root setup target removes central hardcodes (R5.1, R12.5)', () => {
  const setupBody = taskBody(TASKFILE, 'setup');

  it('extracts only the setup target, not setup-android', () => {
    expect(setupBody.startsWith('  setup:')).toBe(true);
    expect(setupBody).not.toMatch(/setup-android:/);
  });

  it('runs no hardcoded `playwright install` in the setup body (R5.1)', () => {
    expect(setupBody).not.toMatch(/playwright\s+install/i);
  });

  it('sets no NODE_TLS_REJECT_UNAUTHORIZED=0 TLS-disabling default (R12.5)', () => {
    expect(setupBody).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/);
  });

  it('documents the proxy/mirror-CA path instead of disabling TLS (R12.5)', () => {
    expect(setupBody).toMatch(/HTTPS_PROXY/);
  });

  it('delegates provisioning via the shared planner (R5.5)', () => {
    expect(setupBody).toMatch(/setup-planner\.ts plan/);
  });

  it('runs each tool\'s own setup task by taskfile path (R6.1)', () => {
    expect(setupBody).toMatch(/--taskfile "tools\/\$id\/Taskfile\.yml"/);
    expect(setupBody).toMatch(/--dir "tools\/\$id" setup/);
  });
});

describe('gatherToolSetupFacts + planToolSetup reflect folder-presence', () => {
  /** Scaffold a `tools/<id>/` with a manifest and optional deps/Taskfile shape. */
  function mkTool(
    ws: string,
    id: string,
    opts: { packageJson?: boolean; pyproject?: boolean; setupTask?: boolean },
  ): void {
    const dir = path.join(ws, 'tools', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'tool.manifest.json'),
      JSON.stringify({ schemaVersion: '1', id }),
      'utf8',
    );
    if (opts.packageJson) fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
    if (opts.pyproject) fs.writeFileSync(path.join(dir, 'pyproject.toml'), '', 'utf8');
    const task = opts.setupTask ? '  setup:\n    cmds:\n      - echo hi\n' : '  run:\n    cmds:\n      - echo hi\n';
    fs.writeFileSync(path.join(dir, 'Taskfile.yml'), `version: "3"\ntasks:\n${task}`, 'utf8');
  }

  it('discovers folder-presence facts and plans deps + setup correctly', () => {
    const ws = makeTmpDir('setup-deleg-');
    try {
      mkTool(ws, 'aa', { packageJson: true, setupTask: true }); // pnpm tool WITH setup
      mkTool(ws, 'bb', { pyproject: true, setupTask: false }); // uv tool WITHOUT setup
      mkTool(ws, 'cc-template-example', { packageJson: true, setupTask: true }); // excluded

      const facts = gatherToolSetupFacts(ws);
      // Sorted, manifest-gated, template excluded.
      expect(facts.map((f) => f.id)).toEqual(['aa', 'bb']);

      const plan = planToolSetup(facts);
      expect(plan.steps).toEqual([
        { id: 'aa', installPnpm: true, runSetup: true },
        { id: 'bb', installPnpm: false, runSetup: false },
      ]);
      expect(plan.runUvSync).toBe(true); // bb is a uv tool
      expect(plan.isEmpty).toBe(false);
    } finally {
      rmTmpDir(ws);
    }
  });

  it('an empty tools/ set produces a clean empty plan (R6.6)', () => {
    const ws = makeTmpDir('setup-deleg-empty-');
    try {
      fs.mkdirSync(path.join(ws, 'tools'), { recursive: true });
      const plan = planToolSetup(gatherToolSetupFacts(ws));
      expect(plan.isEmpty).toBe(true);
      expect(plan.steps).toEqual([]);
      expect(plan.runUvSync).toBe(false);
    } finally {
      rmTmpDir(ws);
    }
  });
});
