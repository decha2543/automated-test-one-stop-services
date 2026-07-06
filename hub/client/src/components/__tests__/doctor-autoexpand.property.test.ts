// Feature: one-stop-service-upgrade, Property 5: DoctorPanel auto-expand predicate
import type { DoctorCategory, DoctorCheck, DoctorReport } from '@hub/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { shouldAutoExpand } from '../doctor-panel-helpers';

const CATEGORIES: readonly DoctorCategory[] = [
  'required-install',
  'optional-install',
  'optional-process',
] as const;

/** The category set whose failures should trigger auto-expand (R3.8). */
const EXPAND_CATEGORIES: ReadonlySet<DoctorCategory> = new Set<DoctorCategory>([
  'required-install',
  'optional-install',
]);

/**
 * Smart generator for a single DoctorCheck constrained to the real
 * {@link DoctorCheck} shape: a non-empty name, an ok boolean, a category drawn
 * from the three valid groups, and optional version/hint fields.
 */
const checkArb: fc.Arbitrary<DoctorCheck> = fc.record(
  {
    name: fc.string({ minLength: 1, maxLength: 24 }),
    ok: fc.boolean(),
    category: fc.constantFrom(...CATEGORIES),
    version: fc.option(fc.string({ maxLength: 16 }), { nil: undefined }),
    hint: fc.option(fc.string({ maxLength: 32 }), { nil: undefined }),
  },
  { requiredKeys: ['name', 'ok', 'category'] },
);

/** Generator for a ready DoctorReport including the type-required fields. */
const reportArb: fc.Arbitrary<DoctorReport> = fc.record({
  checks: fc.array(checkArb, { maxLength: 12 }),
  overallOk: fc.boolean(),
  credentialsOk: fc.boolean(),
});

/** Independent reference implementation of the predicate's specification. */
function expectedAutoExpand(report: DoctorReport): boolean {
  return report.checks.some((check) => !check.ok && EXPAND_CATEGORIES.has(check.category));
}

describe('Property 5: DoctorPanel auto-expand predicate', () => {
  it('returns true iff some required-install or optional-install check has ok === false', () => {
    fc.assert(
      fc.property(reportArb, (report) => {
        expect(shouldAutoExpand(report)).toBe(expectedAutoExpand(report));
      }),
      { numRuns: 1000 },
    );
  });

  it('stays collapsed (false) when only optional-process checks fail', () => {
    fc.assert(
      fc.property(
        // At least one optional-process check (may fail) plus install-group
        // checks that always pass — auto-expand must be false.
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 24 }),
            ok: fc.boolean(),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 24 }),
            category: fc.constantFrom<DoctorCategory>('required-install', 'optional-install'),
          }),
          { maxLength: 6 },
        ),
        (optionalProcessChecks, alwaysOkInstallChecks) => {
          const checks: DoctorCheck[] = [
            // optional-process group: any ok values, including failures
            ...optionalProcessChecks.map(
              (c): DoctorCheck => ({ ...c, category: 'optional-process' }),
            ),
            // install groups: all passing so they cannot trigger expansion
            ...alwaysOkInstallChecks.map((c): DoctorCheck => ({ ...c, ok: true })),
          ];
          const report: DoctorReport = { checks, overallOk: false, credentialsOk: true };
          expect(shouldAutoExpand(report)).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('expands when a required-install or optional-install check fails', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<DoctorCategory>('required-install', 'optional-install'),
        fc.array(checkArb, { maxLength: 6 }),
        (failingCategory, otherChecks) => {
          const report: DoctorReport = {
            checks: [...otherChecks, { name: 'failing-dep', ok: false, category: failingCategory }],
            overallOk: false,
            credentialsOk: true,
          };
          expect(shouldAutoExpand(report)).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('stays collapsed for an empty checks array', () => {
    expect(shouldAutoExpand({ checks: [], overallOk: true, credentialsOk: true })).toBe(false);
  });
});
