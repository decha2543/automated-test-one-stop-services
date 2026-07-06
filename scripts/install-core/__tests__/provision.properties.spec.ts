// scripts/install-core/__tests__/provision.properties.spec.ts
//
// Property-based tests for the Playwright provisioning decision
// (install-and-provisioning-overhaul). One property per test (`it`); ≥100
// iterations; fast-check under vitest, mirroring the install-core convention.
//
// Validates: Requirements 7.1, 7.2, 7.4, 7.7 (Property 5); 7.8 (Property 6)

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decideProvisionAction, effectiveRevision, reportCoreInstall } from '../index.js';
import { arbBrowserProvisionOutcome, arbProvisionInputs } from './arbitraries.js';

// =============================================================================
// Feature: install-and-provisioning-overhaul, Property 5
// Playwright provision decision never reuses a mismatched revision.
// For any (mirrorHost, requiredRevision, presentRevision), decideProvisionAction
// yields `mirror` when the mirror is configured; otherwise `reuse` when
// presentRevision === requiredRevision; otherwise a download/extract action
// whose effective revision equals requiredRevision — so no chosen action ever
// reuses or installs a revision different from the one required by the installed
// Playwright version.
// **Validates: Requirements 7.1, 7.2, 7.4, 7.7**
// =============================================================================
describe('Feature: install-and-provisioning-overhaul, Property 5', () => {
  it('follows the mirror > reuse > reprovision > archive precedence and never lands a mismatched revision', () => {
    fc.assert(
      fc.property(arbProvisionInputs, (inputs) => {
        const action = decideProvisionAction(inputs);
        const mirrorConfigured =
          inputs.mirrorHost !== null && inputs.mirrorHost.trim().length > 0;

        // 1) The precedence holds exactly (R7.1 > R7.2 > R7.7).
        if (mirrorConfigured) {
          expect(action.kind).toBe('mirror'); // R7.1
        } else if (inputs.presentRevision === inputs.requiredRevision) {
          expect(action.kind).toBe('reuse'); // R7.2
        } else if (inputs.presentRevision !== null) {
          expect(action).toEqual({ kind: 'reprovision', reason: 'revision-mismatch' }); // R7.7
        } else {
          expect(action.kind).toBe('archive'); // R7.7 (manual archive)
        }

        // 2) Headline safety invariant (R7.4/R7.7): whatever ends up on disk is
        //    ALWAYS the required revision — no action reuses/installs a different one.
        expect(effectiveRevision(action, inputs)).toBe(inputs.requiredRevision);

        // 3) `reuse` is selected ONLY when the present build already matches —
        //    a present-but-different build can never be reused (R7.7).
        if (action.kind === 'reuse') {
          expect(inputs.presentRevision).toBe(inputs.requiredRevision);
        }
      }),
      { numRuns: 200 },
    );
  });
});

// =============================================================================
// Feature: install-and-provisioning-overhaul, Property 6
// Browser provisioning is non-fatal to the Core install.
// For any browser-provisioning outcome, including failure, the Core_Tool_Set
// install result is unchanged and still reported successful.
// **Validates: Requirements 7.8**
// =============================================================================
describe('Feature: install-and-provisioning-overhaul, Property 6', () => {
  it('reports the Core result from Core steps alone, regardless of any provisioning outcome', () => {
    fc.assert(
      fc.property(fc.boolean(), arbBrowserProvisionOutcome, (coreStepsOk, outcome) => {
        const report = reportCoreInstall(coreStepsOk, outcome);

        // Core success is a function of Core steps ONLY — provisioning never flips it.
        expect(report.coreOk).toBe(coreStepsOk);
        // A failed provision is surfaced for reporting, not folded into Core success.
        expect(report.provisioningFailed).toBe(!outcome.ok);
      }),
      { numRuns: 200 },
    );

    // R7.8 spotlight: a FAILED browser provision with healthy Core stays successful.
    const report = reportCoreInstall(true, { ok: false, message: 'public CDN blocked' });
    expect(report.coreOk).toBe(true);
    expect(report.provisioningFailed).toBe(true);
  });
});
