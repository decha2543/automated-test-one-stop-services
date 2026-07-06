// scripts/install-core/__tests__/cli.spec.ts
//
// Tests for the headless install CLI (scripts/install-tool.ts, Task 12 of
// install-and-provisioning-overhaul):
//   - Property 11 (12.1): the CLI reports the failing stage and exits non-zero.
//   - Example (12.2): Hub / CLI command parity — both run the SAME fixed-constant
//     `task ... setup` for a given tool, and the CLI delegates to the shared
//     `runInstallPipeline` rather than re-implementing deps/setup.
//
// The CLI lives one level up (scripts/install-tool.ts); this spec sits in the
// install-core __tests__ folder (Biome-excluded), reusing its wired vitest +
// fast-check. The CLI's `main()` is import-guarded, so importing it here never
// spawns a process. Every stage is driven through a FAKE InstallEffects — no
// real spawn, clone, or filesystem write.

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { exitCodeForResult, installTool } from '../../install-tool.js';
import {
    buildToolSetupInvocation,
    type InstallEffects,
    type InstallRequest,
    type InstallStage,
    runInstallPipeline,
} from '../index.js';
import { arbInvalidToolId, arbValidGitUrl, arbValidToolId } from './arbitraries.js';

// ── Fake effects: fail at a chosen stage, otherwise succeed ──────────────────
//
// `gatherFacts` reports BOTH a package.json and a setup task so the `deps` and
// `setup` stages are actually exercised; `installDeps` throws to fail `deps`,
// `runSetup` returns a non-zero exit to fail `setup`, `cloneRegistry` throws to
// fail `clone`. No real child process is ever spawned.
type FailAt = 'clone' | 'deps' | 'setup' | 'none';

function effectsFailingAt(failAt: FailAt): InstallEffects {
  return {
    cloneRegistry: () => {
      if (failAt === 'clone') throw new Error('clone failed (fake)');
    },
    gatherFacts: (id) => ({ id, hasPackageJson: true, isUvTool: false, hasSetupTask: true }),
    installDeps: () => {
      if (failAt === 'deps') throw new Error('deps install failed (fake)');
    },
    runSetup: ({ id }) => ({ id, exitCode: failAt === 'setup' ? 1 : 0 }),
  };
}

// ── Scenario model: one per failing stage, plus the success case ─────────────
type Scenario =
  | { readonly kind: 'validate'; readonly id: string }
  | { readonly kind: 'clone'; readonly id: string; readonly gitUrl: string }
  | { readonly kind: 'deps'; readonly id: string }
  | { readonly kind: 'setup'; readonly id: string }
  | { readonly kind: 'success'; readonly id: string };

interface BuiltScenario {
  readonly request: InstallRequest;
  readonly effects: InstallEffects;
  /** The stage expected to fail, or 'success' when the install should succeed. */
  readonly expected: InstallStage | 'success';
}

function buildScenario(s: Scenario): BuiltScenario {
  switch (s.kind) {
    case 'validate':
      // An invalid id is rejected by the pipeline's validate gate before any effect.
      return {
        request: { id: s.id, source: { kind: 'local' } },
        effects: effectsFailingAt('none'),
        expected: 'validate',
      };
    case 'clone':
      return {
        request: { id: s.id, source: { kind: 'registry', gitUrl: s.gitUrl, ref: 'main' } },
        effects: effectsFailingAt('clone'),
        expected: 'clone',
      };
    case 'deps':
      return {
        request: { id: s.id, source: { kind: 'local' } },
        effects: effectsFailingAt('deps'),
        expected: 'deps',
      };
    case 'setup':
      return {
        request: { id: s.id, source: { kind: 'local' } },
        effects: effectsFailingAt('setup'),
        expected: 'setup',
      };
    case 'success':
      return {
        request: { id: s.id, source: { kind: 'local' } },
        effects: effectsFailingAt('none'),
        expected: 'success',
      };
  }
}

/** Scenario generator: each failing stage + the success case, over valid/invalid ids. */
const arbScenario: fc.Arbitrary<Scenario> = fc.oneof(
  arbInvalidToolId.map((id) => ({ kind: 'validate', id }) as const),
  fc.tuple(arbValidToolId, arbValidGitUrl).map(([id, gitUrl]) => ({ kind: 'clone', id, gitUrl }) as const),
  arbValidToolId.map((id) => ({ kind: 'deps', id }) as const),
  arbValidToolId.map((id) => ({ kind: 'setup', id }) as const),
  arbValidToolId.map((id) => ({ kind: 'success', id }) as const),
);

// =============================================================================
// Feature: install-and-provisioning-overhaul, Property 11
// CLI reports the failing stage and exits non-zero.
// For any stage that fails during a CLI install, the result has `ok === false`
// with `failedStage` set to the failing stage, and the derived process exit code
// is non-zero; a successful install yields `ok === true` and exit code 0.
// **Validates: Requirements 9.4**
// =============================================================================
describe('Feature: install-and-provisioning-overhaul, Property 11', () => {
  it('sets ok=false + failedStage and derives a non-zero exit per failing stage (success → exit 0)', () => {
    fc.assert(
      fc.property(arbScenario, (scenario) => {
        const { request, effects, expected } = buildScenario(scenario);

        // Drive the CLI's install (which delegates to runInstallPipeline) with
        // FAKE effects — no real spawn. exitCodeForResult is the CLI's pure map.
        const result = installTool(request, effects);
        const exitCode = exitCodeForResult(result);

        if (expected === 'success') {
          expect(result.ok).toBe(true);
          expect(result.failedStage).toBeUndefined();
          expect(exitCode).toBe(0);
        } else {
          expect(result.ok).toBe(false);
          expect(result.failedStage).toBe(expected);
          expect(exitCode).not.toBe(0);
        }
      }),
      { numRuns: 200 },
    );
  });
});

// ── Recording effects: capture the effect sequence the pipeline drives ───────
function recordingEffects(): { effects: InstallEffects; calls: string[] } {
  const calls: string[] = [];
  const effects: InstallEffects = {
    cloneRegistry: (i) => {
      calls.push(`cloneRegistry:${i.id}`);
    },
    gatherFacts: (id) => {
      calls.push(`gatherFacts:${id}`);
      return { id, hasPackageJson: true, isUvTool: false, hasSetupTask: true };
    },
    installDeps: (i) => {
      calls.push(`installDeps:${i.manager}`);
    },
    runSetup: (i) => {
      calls.push(`runSetup:${i.id}`);
      return { id: i.id, exitCode: 0 };
    },
  };
  return { effects, calls };
}

/**
 * The Hub Post_Install_Hook command, replicated byte-identically in
 * `hub/server/src/services/tool-plugins.ts` (`runToolSetupTask`):
 *   task --taskfile tools/<id>/Taskfile.yml --dir tools/<id> setup
 * Hub↔CLI parity (R9.2) is at this command level.
 */
function hubHookCommand(id: string): string {
  return `task --taskfile tools/${id}/Taskfile.yml --dir tools/${id} setup`;
}

// =============================================================================
// Example (Task 12.2): Hub / CLI parity (R9.2)
// =============================================================================
describe('Hub / CLI tool-setup parity (Requirement 9.2)', () => {
  it('runs the SAME fixed-constant `task ... setup` command as the Hub hook for the same id', () => {
    for (const id of ['playwright', 'k6', 'robot-framework', 'my-tool']) {
      const inv = buildToolSetupInvocation(id);
      // The CLI's setup runs this argv (via install-core effects); the Hub hook
      // runs the identical command string — same Tool_Setup_Task, same tool.
      expect([inv.file, ...inv.args].join(' ')).toBe(hubHookCommand(id));
    }
  });

  it('delegates the deps + setup path to the shared runInstallPipeline (no re-implementation)', () => {
    const request: InstallRequest = { id: 'playwright', source: { kind: 'local' } };
    const viaCli = recordingEffects();
    const viaPipeline = recordingEffects();

    installTool(request, viaCli.effects);
    runInstallPipeline(request, viaPipeline.effects);

    // The CLI drives the EXACT same effect sequence as the shared pipeline …
    expect(viaCli.calls).toEqual(viaPipeline.calls);
    // … and that sequence installs deps then runs the tool's setup task.
    expect(viaCli.calls).toContain('installDeps:pnpm');
    expect(viaCli.calls).toContain('runSetup:playwright');
  });
});
