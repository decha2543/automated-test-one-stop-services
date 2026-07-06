// scripts/install-core/__tests__/install-core.properties.spec.ts
//
// Property-based tests for the shared install-core library
// (install-and-provisioning-overhaul). One property per test; ≥100 iterations;
// fast-check under vitest, mirroring the `scripts/manifests/__tests__/`
// convention (plain vitest + fc.assert).
//
// Validates: Requirements 8.5, 12.2 (Property 9); 9.3, 9.5, 12.1 (Property 10)

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildToolSetupInvocation,
  runInstallPipeline,
  SAFE_ID,
  TOOL_SETUP_TIMEOUT_MS,
} from '../index.js';
import { arbRejectableRequest, arbValidToolId, makeSpyEffects } from './arbitraries.js';

// =============================================================================
// Feature: install-and-provisioning-overhaul, Property 9
// Tool tasks run via a fixed command constant.
// For any tool id, the command used to run a Tool_Setup_Task is built from a
// fixed command constant plus a SAFE_ID-validated path slot only; no
// tool-supplied string is interpolated into the shell.
// **Validates: Requirements 8.5, 12.2**
// =============================================================================
describe('Feature: install-and-provisioning-overhaul, Property 9', () => {
  it('builds a fixed argv (task --taskfile tools/<id>/Taskfile.yml --dir tools/<id> setup) with the id only in the path slots', () => {
    fc.assert(
      fc.property(arbValidToolId, (id) => {
        const inv = buildToolSetupInvocation(id);

        // The executable is a fixed constant — never tool-supplied.
        expect(inv.file).toBe('task');

        // The whole argv is exactly the fixed template: 3 constant tokens plus the
        // 2 `tools/<id>/…` path slots — nothing extra is interpolated (R12.2).
        expect(inv.args).toEqual([
          '--taskfile',
          `tools/${id}/Taskfile.yml`,
          '--dir',
          `tools/${id}`,
          'setup',
        ]);

        // The constant positions never vary with the id …
        expect(inv.args[0]).toBe('--taskfile');
        expect(inv.args[2]).toBe('--dir');
        expect(inv.args[4]).toBe('setup');
        // … and the id appears ONLY inside the two tools/<id> path slots.
        expect(inv.args[1]).toBe(`tools/${id}/Taskfile.yml`);
        expect(inv.args[3]).toBe(`tools/${id}`);

        // Argv-form (no shell string) + safe spawn options: captured output, a
        // wall-clock timeout, and no console-window flash on Windows.
        expect(inv.options).toEqual({
          timeout: TOOL_SETUP_TIMEOUT_MS,
          stdio: 'pipe',
          windowsHide: true,
        });

        // The id slot is SAFE_ID-validated, so it can carry no shell metacharacter.
        expect(SAFE_ID.test(id)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

// =============================================================================
// Feature: install-and-provisioning-overhaul, Property 10
// Validation gates all side effects.
// For any tool id that fails SAFE_ID, or any git URL that fails SAFE_GIT_URL, the
// install path performs no clone, dependency install, or other side-effecting
// action — rejection always precedes any side effect.
// **Validates: Requirements 9.3, 9.5, 12.1**
// =============================================================================
describe('Feature: install-and-provisioning-overhaul, Property 10', () => {
  it('rejects an invalid id or git URL at the validate stage with ZERO side-effecting calls', () => {
    fc.assert(
      fc.property(arbRejectableRequest, (request) => {
        const { effects, calls } = makeSpyEffects();

        const result = runInstallPipeline(request, effects);

        // The request is rejected …
        expect(result.ok).toBe(false);
        // … at the validate stage (before clone / deps / setup) …
        expect(result.failedStage).toBe('validate');
        // … and NO side-effecting effect was invoked before the rejection.
        expect(calls).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});
