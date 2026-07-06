// scripts/manifests/__tests__/install-provisioning.properties.spec.ts
//
// Property-based tests for the install-and-provisioning-overhaul spec.
// One property per test; ≥100 iterations; fast-check under vitest, mirroring
// the `scripts/manifests/__tests__/` convention (plain vitest + fc.assert).
//
// Validates: Requirements 6.2, 5.5, 6.1, 6.3, 6.4, 6.6, 6.5

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverManifestPaths, discoverToolIds, isToolPresent } from '../discover.js';
import {
    aggregateSetupFailures,
    planToolSetup,
    SETUP_FAILURE_HINT,
    type ToolSetupFacts,
    type ToolSetupOutcome,
} from '../setup-planner.js';
import { arbToolFolderSet, type ToolFolderSpec, toolFolderName } from './arbitraries.js';
import { makeTmpDir, rmTmpDir } from './_helpers.js';

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmTmpDir(d);
});

/** Materialise a random folder set under `<ws>/tools/`; return the workspace root. */
function materialise(specs: readonly ToolFolderSpec[]): string {
  const ws = makeTmpDir('install-prov-');
  tmpDirs.push(ws);
  for (const spec of specs) {
    const name = toolFolderName(spec);
    const dir = path.join(ws, 'tools', name);
    fs.mkdirSync(dir, { recursive: true });
    if (spec.hasManifest) {
      fs.writeFileSync(
        path.join(dir, 'tool.manifest.json'),
        JSON.stringify({ schemaVersion: '1', id: name }),
        'utf8',
      );
    }
  }
  return ws;
}

/** The tool ids discovery must return: normal-named, non-hidden, manifest-bearing. */
function expectedIds(specs: readonly ToolFolderSpec[]): string[] {
  return specs
    .filter((s) => s.kind === 'normal' && s.hasManifest)
    .map((s) => s.token)
    .sort();
}

// =============================================================================
// Feature: install-and-provisioning-overhaul, Property 1
// Tool discovery is folder-presence and deterministic.
// For any `tools/` contents, discovery returns exactly the folders that contain
// a `tool.manifest.json`, excluding `.`-prefixed and `*-template-example` names,
// in a stable sorted order independent of filesystem iteration order.
// **Validates: Requirements 6.2**
// =============================================================================
describe('Feature: install-and-provisioning-overhaul, Property 1', () => {
  it('discovery is folder-presence + deterministic: exact set, sorted, manifest-gated, excludes hidden + template', () => {
    fc.assert(
      fc.property(arbToolFolderSet(), (specs) => {
        const ws = materialise(specs);
        const expected = expectedIds(specs);

        const ids = discoverToolIds(ws);

        // Exactly the manifest-bearing, non-hidden, non-template folders …
        expect(ids).toEqual(expected);
        // … in a stable sorted order independent of filesystem iteration order.
        expect(ids).toEqual([...ids].sort());

        // discoverManifestPaths agrees: every path is <ws>/tools/<id>/tool.manifest.json.
        const fromPaths = discoverManifestPaths(ws).map((p) => path.basename(path.dirname(p)));
        expect(fromPaths).toEqual(expected);

        // isToolPresent is exactly membership of the discovered id set, for every kind.
        for (const spec of specs) {
          expect(isToolPresent(ws, spec.token)).toBe(expected.includes(spec.token));
        }
      }),
      { numRuns: 200 },
    );
  });
});

// A random set of per-tool provisioning facts with unique ids — the pure input
// space of `planToolSetup` (Property 3). Ids are deduped so the plan's
// per-step mapping is unambiguous.
const arbToolSetupFacts: fc.Arbitrary<ToolSetupFacts[]> = fc
  .array(
    fc.record({
      token: fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/),
      hasPackageJson: fc.boolean(),
      isUvTool: fc.boolean(),
      hasSetupTask: fc.boolean(),
    }),
    { maxLength: 8 },
  )
  .map((rows) => {
    const seen = new Set<string>();
    const facts: ToolSetupFacts[] = [];
    for (const r of rows) {
      if (seen.has(r.token)) continue;
      seen.add(r.token);
      facts.push({
        id: r.token,
        hasPackageJson: r.hasPackageJson,
        isUvTool: r.isUvTool,
        hasSetupTask: r.hasSetupTask,
      });
    }
    return facts;
  });

// =============================================================================
// Feature: install-and-provisioning-overhaul, Property 3
// Tool-setup delegation and no-op.
// For any present tool, Setup_Task invokes the tool's `setup` task IFF the tool
// defines one; a tool with no `setup` task has its dependencies installed and
// the setup step skipped with no error; with an empty set of tool folders, Core
// provisioning completes with no error.
// **Validates: Requirements 5.5, 6.1, 6.3, 6.4, 6.6**
// =============================================================================
describe('Feature: install-and-provisioning-overhaul, Property 3', () => {
  it('plans deps-always + setup-iff-defined, one step per tool, uv-sync iff any uv tool', () => {
    fc.assert(
      fc.property(arbToolSetupFacts, (facts) => {
        const plan = planToolSetup(facts);

        // Exactly one plan step per tool, preserving discovery order (R6.4: the
        // planner is data-driven, so any added/removed tool just changes facts).
        expect(plan.steps.map((s) => s.id)).toEqual(facts.map((f) => f.id));

        for (let i = 0; i < facts.length; i++) {
          // Deps are installed whenever a package.json is present — regardless of
          // whether the tool defines a setup task (R6.3: no-setup ⇒ deps + skip).
          expect(plan.steps[i].installPnpm).toBe(facts[i].hasPackageJson);
          // The tool's setup task is invoked IFF the tool defines one (R6.1, R6.3).
          expect(plan.steps[i].runSetup).toBe(facts[i].hasSetupTask);
        }

        // A single root `uv sync` runs IFF any present tool is a uv tool — the
        // central re-implementation is gone, provisioning is delegated (R5.5).
        expect(plan.runUvSync).toBe(facts.some((f) => f.isUvTool));

        // Empty tools/ set ⇒ empty plan ⇒ Core completes cleanly (R6.6).
        expect(plan.isEmpty).toBe(facts.length === 0);
      }),
      { numRuns: 200 },
    );
  });

  it('an empty tools/ set yields an empty, uv-sync-free plan (R6.6)', () => {
    const plan = planToolSetup([]);
    expect(plan.isEmpty).toBe(true);
    expect(plan.steps).toEqual([]);
    expect(plan.runUvSync).toBe(false);
  });
});

// A random set of tool-setup outcomes with unique ids and a mix of success /
// non-zero exit codes — the input space of `aggregateSetupFailures` (Property 4).
const arbSetupOutcomes: fc.Arbitrary<ToolSetupOutcome[]> = fc
  .array(
    fc.record({
      token: fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/),
      exitCode: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 255 })),
    }),
    { maxLength: 8 },
  )
  .map((rows) => {
    const seen = new Set<string>();
    const outcomes: ToolSetupOutcome[] = [];
    for (const r of rows) {
      if (seen.has(r.token)) continue;
      seen.add(r.token);
      outcomes.push({ id: r.token, exitCode: r.exitCode });
    }
    return outcomes;
  });

// =============================================================================
// Feature: install-and-provisioning-overhaul, Property 4
// Tool-setup failure is reported with tool id and a hint.
// For any tool whose `setup` task exits non-zero, the aggregated Setup_Task
// result names that tool's id and includes at least one remediation hint.
// **Validates: Requirements 6.5**
// =============================================================================
describe('Feature: install-and-provisioning-overhaul, Property 4', () => {
  it('names every non-zero-exit tool id and always carries a remediation hint', () => {
    fc.assert(
      fc.property(arbSetupOutcomes, (outcomes) => {
        const report = aggregateSetupFailures(outcomes);
        const expectedFailing = outcomes.filter((o) => o.exitCode !== 0).map((o) => o.id);

        // The report names exactly the tools whose setup exited non-zero.
        expect(report.failedToolIds).toEqual(expectedFailing);
        expect(report.ok).toBe(expectedFailing.length === 0);

        if (expectedFailing.length === 0) {
          expect(report.message).toBe('');
          return;
        }

        // Every failing tool id is named on its own line (the `- <id>:` form is
        // unambiguous even when one id is a prefix of another) …
        for (const id of expectedFailing) {
          expect(report.message).toContain(`- ${id}:`);
        }
        // … and at least one remediation hint is always included (R6.5).
        expect(report.message).toContain(SETUP_FAILURE_HINT);
      }),
      { numRuns: 200 },
    );
  });
});
