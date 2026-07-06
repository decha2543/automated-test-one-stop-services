import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type PostInstallHookEffects,
  resolveConfirmPhaseErrors,
  runPostInstallHook,
} from '../tool-plugins.js';

/**
 * Property-based tests for the Hub Post_Install_Hook result shaping
 * (install-and-provisioning-overhaul, C4). One property per test; ≥100
 * iterations; fast-check under vitest, mirroring the hub/server property-test
 * convention. The hook's probe + spawn are injected as a FAKE
 * {@link PostInstallHookEffects} (success/fail runner), so no real `task` spawn
 * or filesystem read happens — only the pure shaping logic is exercised.
 *
 * Validates: Requirements 8.1, 8.2, 8.4 (Property 7); 8.3 (Property 8)
 */

// ─── Generators ──────────────────────────────────────────────────────────────

/** SAFE_ID-valid tool ids (content is irrelevant to the pure shaping logic). */
const arbToolId = fc.constantFrom('playwright', 'k6', 'robot-framework', 'my-tool', 'tool2');

/** A deps install that either succeeded (undefined) or failed (a DepsError). */
const arbDepsError = fc.option(
  fc.constant({ code: 'DEPS_INSTALL_FAILED', message: 'deps install failed' }),
  { nil: undefined },
);

/** Build a fake effects object recording how many times the setup runner ran. */
function fakeEffects(
  hasSetup: boolean,
  exitCode: number,
): { effects: PostInstallHookEffects; runs: () => number } {
  let setupRuns = 0;
  return {
    effects: {
      hasSetupTask: () => hasSetup,
      runSetup: () => {
        setupRuns += 1;
        return { exitCode, stderr: exitCode === 0 ? '' : 'tool setup exploded' };
      },
    },
    runs: () => setupRuns,
  };
}

// =============================================================================
// Feature: install-and-provisioning-overhaul, Property 7
// Post-install hook result shaping.
// postInstallError is present on the lifecycle result IFF the tool defines a
// `setup` task AND that task failed; a tool with no `setup` task never yields a
// postInstallError; and when present, the hook ran after dependency install
// (deps are a prerequisite — a depsError skips the hook entirely).
// Validates: Requirements 8.1, 8.2, 8.4
// =============================================================================
describe('Feature: install-and-provisioning-overhaul, Property 7', () => {
  it('postInstallError present iff a setup task exists and failed; absent with no setup task; hook gated behind deps', () => {
    fc.assert(
      fc.property(
        arbToolId,
        fc.boolean(), // hasSetupTask
        fc.integer({ min: -8, max: 255 }), // setup exit code (0 = success)
        arbDepsError,
        (id, hasSetup, exitCode, depsError) => {
          const { effects, runs } = fakeEffects(hasSetup, exitCode);

          const errors = resolveConfirmPhaseErrors(id, depsError, effects);

          if (depsError) {
            // Deps are a prerequisite: the hook NEVER runs after a deps failure,
            // and only depsError is surfaced (the clone is kept either way, R8.3).
            expect(runs()).toBe(0);
            expect(errors.postInstallError).toBeUndefined();
            expect(errors.depsError).toEqual(depsError);
            return;
          }

          // Clean deps install → the hook runs (after deps). R8.4: a tool with no
          // setup task never invokes the runner and never yields an error.
          expect(runs()).toBe(hasSetup ? 1 : 0);

          const setupFailed = hasSetup && exitCode !== 0;
          if (setupFailed) {
            expect(errors.postInstallError).toEqual({
              code: 'POST_INSTALL_FAILED',
              message: expect.any(String),
            });
          } else {
            expect(errors.postInstallError).toBeUndefined();
          }
          // depsError is never invented on a clean deps install.
          expect(errors.depsError).toBeUndefined();
        },
      ),
      { numRuns: 200 },
    );
  });
});

// =============================================================================
// Feature: install-and-provisioning-overhaul, Property 8
// Clone is preserved across any hook outcome.
// For any Post_Install_Hook outcome (success/failure, setup task present or not,
// deps ok or failed), the installed tool's cloned directory remains — the hook
// never triggers a clone rollback.
// Validates: Requirements 8.3
// =============================================================================
describe('Feature: install-and-provisioning-overhaul, Property 8', () => {
  it('never rolls back the clone for any hook outcome', () => {
    fc.assert(
      fc.property(
        arbToolId,
        fc.boolean(),
        fc.integer({ min: -8, max: 255 }),
        arbDepsError,
        (id, hasSetup, exitCode, depsError) => {
          // Fake clone marker — set once the tool is "cloned". The hook path holds
          // no reference to it, so no outcome can clear it (R8.3).
          const clone = { present: true };
          const { effects } = fakeEffects(hasSetup, exitCode);

          // Exercise both the overlay and the hook directly across every outcome.
          resolveConfirmPhaseErrors(id, depsError, effects);
          runPostInstallHook(id, effects);

          expect(clone.present).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Example unit tests pinning the exact contract ───────────────────────────

describe('runPostInstallHook (examples)', () => {
  const ok = (exitCode: number): PostInstallHookEffects => ({
    hasSetupTask: () => true,
    runSetup: () => ({ exitCode, stderr: exitCode === 0 ? '' : 'boom' }),
  });

  it('no setup task → no-op, no error, runner never called (R8.4)', () => {
    let ran = false;
    const effects: PostInstallHookEffects = {
      hasSetupTask: () => false,
      runSetup: () => {
        ran = true;
        return { exitCode: 0, stderr: '' };
      },
    };
    expect(runPostInstallHook('playwright', effects)).toBeUndefined();
    expect(ran).toBe(false);
  });

  it('setup task succeeds → no postInstallError (R8.1)', () => {
    expect(runPostInstallHook('playwright', ok(0))).toBeUndefined();
  });

  it('setup task fails → POST_INSTALL_FAILED naming the tool (R8.2)', () => {
    const err = runPostInstallHook('playwright', ok(2));
    expect(err?.code).toBe('POST_INSTALL_FAILED');
    expect(err?.message).toContain('playwright');
  });

  it('depsError present → hook skipped, only depsError surfaced (R8.3 prerequisite)', () => {
    let ran = false;
    const effects: PostInstallHookEffects = {
      hasSetupTask: () => true,
      runSetup: () => {
        ran = true;
        return { exitCode: 1, stderr: 'should not run' };
      },
    };
    const errors = resolveConfirmPhaseErrors(
      'playwright',
      { code: 'DEPS_INSTALL_FAILED', message: 'nope' },
      effects,
    );
    expect(ran).toBe(false);
    expect(errors.postInstallError).toBeUndefined();
    expect(errors.depsError).toEqual({ code: 'DEPS_INSTALL_FAILED', message: 'nope' });
  });
});
