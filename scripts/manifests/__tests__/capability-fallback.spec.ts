// scripts/manifests/__tests__/capability-fallback.spec.ts
//
// Property 5 — "graceful degrade" (design §7.3; task 21). An installed tool
// whose manifest declares NO capability blocks (`run` / `reports` / `tags`) must
// still be runnable and report-viewable: every downstream consumer falls back to
// a safe default instead of throwing.
//
// This is the INTEGRATION glue that ties the three consumers to ONE manifest:
// the canonical resolver (`resolveCapabilities`) and the shared command builder
// (`buildRunCommandFromInput` / `buildRunVarTokens` / `buildHeadlessToken`) that
// `command-builder.ts`, `reports.ts`, and `tags.ts` all delegate to. The
// per-consumer Hub specs already prove the FS/HTTP edges
// (`reports.test.ts` case (b) — generic `**/*.html`; `tags.routes.test.ts` —
// `tags:none`); the missing piece (added here) is the RUN/COMMAND path: a
// no-capability manifest yields the base `task <ns>:run-<mode>` command with no
// tool-specific run vars and no headless token, even when a section / headless
// intent is supplied.
//
// Validates: Requirements 9.1, 10.1, 10.4
import { describe, expect, it } from 'vitest';
import {
    buildHeadlessToken,
    buildRunCommandFromInput,
    buildRunVarTokens,
} from '../runner-command.js';
import type { ToolManifest } from '../types.js';
import { DEFAULT_REPORT_GLOB, resolveCapabilities, validateManifest } from '../validate.js';
import { baseManifest } from './_helpers.js';

/** Parse the no-capability base fixture and fail loudly if it does not validate. */
function noCapabilityManifest(): ToolManifest {
  const m = baseManifest();
  // Guard the premise: the fixture must carry NONE of the capability blocks.
  expect(m.run).toBeUndefined();
  expect(m.reports).toBeUndefined();
  expect(m.tags).toBeUndefined();
  const res = validateManifest(m);
  if (!res.ok) {
    throw new Error(`expected valid manifest but got: ${JSON.stringify(res.errors)}`);
  }
  return res.manifest;
}

const identity = (v: string): string => v;

describe('capability fallback — a manifest with no capability blocks degrades, never throws', () => {
  const manifest = noCapabilityManifest();
  const ns = manifest.runner.taskNamespace; // 'cy' for the base fixture

  it('reports consumer: resolves to the generic **/*.html glob (no reports block)', () => {
    const resolved = resolveCapabilities(manifest);
    expect(resolved.reports.resultGlob).toBe('**/*.html');
    expect(resolved.reports.resultGlob).toBe(DEFAULT_REPORT_GLOB);
    expect(resolved.reports.kind).toBeNull();
  });

  it('tags consumer: resolves to tags:none (no tags block)', () => {
    expect(resolveCapabilities(manifest).tags.strategy).toBe('none');
  });

  it('run consumer: resolves to no run vars and no headless var (no run block)', () => {
    const { run } = resolveCapabilities(manifest);
    expect(run.vars).toEqual([]);
    expect(run.headlessVar).toBeNull();
  });

  it('command builder: emits the base task <ns>:run-local command, no tool-specific vars', () => {
    const cmd = buildRunCommandFromInput(manifest, {
      mode: 'local',
      type: 'web',
      project: 'app',
      quote: identity,
    });
    expect(cmd).toBe(`task ${ns}:run-local TYPE=web PROJECT=app`);
  });

  it('command builder: drops a requested section / performanceType when no run.vars declared', () => {
    // A caller may still pass section/performanceType (e.g. a generic UI). With
    // no `run.vars`, the shared builder degrades by emitting neither token.
    const cmd = buildRunCommandFromInput(manifest, {
      mode: 'docker',
      project: 'app',
      section: 'auth',
      performanceType: 'LOAD',
      quote: identity,
    });
    expect(cmd).toBe(`task ${ns}:run-docker PROJECT=app`);
    expect(cmd).not.toContain('SECTION');
    expect(cmd).not.toContain('PERFORMANCE_TYPE');
  });

  it('command builder: emits no headless token even when a headless intent is supplied', () => {
    const headless = buildRunCommandFromInput(manifest, {
      mode: 'local',
      project: 'app',
      headless: true,
      quote: identity,
    });
    const headed = buildRunCommandFromInput(manifest, {
      mode: 'local',
      project: 'app',
      headless: false,
      quote: identity,
    });
    // No `run.headlessVar` and no headless cli step ⇒ identical base command.
    expect(headless).toBe(`task ${ns}:run-local PROJECT=app`);
    expect(headed).toBe(headless);
  });

  it('run-var / headless token builders: degrade to empty for every mode + intent', () => {
    // Direct unit-level proof the primitive builders never throw and yield empty.
    expect(buildRunVarTokens(manifest, { SECTION: 'auth', PERFORMANCE_TYPE: 'LOAD' })).toEqual([]);
    for (const mode of ['local', 'docker'] as const) {
      expect(buildHeadlessToken(manifest, { mode })).toBe('');
      expect(buildHeadlessToken(manifest, { mode, headless: true })).toBe('');
      expect(buildHeadlessToken(manifest, { mode, headless: false })).toBe('');
    }
  });
});
