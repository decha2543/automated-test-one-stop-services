// Feature: one-stop-service-upgrade, Property 6: Required-install summary badge
import type { DoctorCategory, DoctorCheck } from '@hub/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { summaryBadge, summaryBadgeText } from '../doctor-panel-helpers';

/**
 * Property test for Task 2.9 — Required-install summary badge.
 *
 * Validates: Requirements 3.11, 3.12
 *
 * The collapsed-state summary badge is computed from the `required-install`
 * group ONLY. When every required-install check passes the badge reads
 * `"X/Y OK"` (X = passing required, Y = total required) with `ok === true`.
 * When at least one required-install check fails the badge reads
 * `"Action required"` with `ok === false`. `optional-install` and
 * `optional-process` checks must never influence the badge.
 */

const CATEGORIES: readonly DoctorCategory[] = [
  'required-install',
  'optional-install',
  'optional-process',
] as const;

/** Categories that must NOT influence the badge. */
const OPTIONAL_CATEGORIES: readonly DoctorCategory[] = [
  'optional-install',
  'optional-process',
] as const;

/**
 * Smart generator for a single {@link DoctorCheck} matching the real shape: a
 * non-empty name, an `ok` boolean, a category drawn from the three valid
 * groups, and optional `version`/`hint` fields.
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

const checksArb: fc.Arbitrary<DoctorCheck[]> = fc.array(checkArb, { maxLength: 50 });

/** A check constrained to an optional (non-required-install) category. */
const optionalCheckArb: fc.Arbitrary<DoctorCheck> = fc.record(
  {
    name: fc.string({ minLength: 1, maxLength: 24 }),
    ok: fc.boolean(),
    category: fc.constantFrom(...OPTIONAL_CATEGORIES),
    version: fc.option(fc.string({ maxLength: 16 }), { nil: undefined }),
    hint: fc.option(fc.string({ maxLength: 32 }), { nil: undefined }),
  },
  { requiredKeys: ['name', 'ok', 'category'] },
);

describe('Property 6: Required-install summary badge', () => {
  it('derives the badge from required-install checks only', () => {
    fc.assert(
      fc.property(checksArb, (checks) => {
        // Independently compute the required-install group's pass count/total.
        const required = checks.filter((check) => check.category === 'required-install');
        const total = required.length;
        const okCount = required.filter((check) => check.ok).length;
        const allRequiredOk = okCount === total;

        const badge = summaryBadge(checks);

        if (allRequiredOk) {
          expect(badge.ok).toBe(true);
          expect(badge.text).toBe(`${okCount}/${total} OK`);
        } else {
          expect(badge.ok).toBe(false);
          expect(badge.text).toBe('Action required');
        }

        // summaryBadgeText is just the badge text.
        expect(summaryBadgeText(checks)).toBe(badge.text);
      }),
      { numRuns: 100 },
    );
  });

  it('shows "X/Y OK" with ok=true when every required-install check passes', () => {
    fc.assert(
      fc.property(
        // Required-install checks that all pass.
        fc.array(fc.string({ minLength: 1, maxLength: 24 }), { maxLength: 12 }),
        // Arbitrary optional-* checks (any ok values) that must not matter.
        fc.array(optionalCheckArb, { maxLength: 12 }),
        (requiredNames, optionalChecks) => {
          const required: DoctorCheck[] = requiredNames.map((name) => ({
            name,
            ok: true,
            category: 'required-install',
          }));
          const checks: DoctorCheck[] = [...required, ...optionalChecks];

          const badge = summaryBadge(checks);
          expect(badge.ok).toBe(true);
          expect(badge.text).toBe(`${required.length}/${required.length} OK`);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('shows "Action required" with ok=false when at least one required-install check fails', () => {
    fc.assert(
      fc.property(
        // Other required checks (any ok).
        fc.array(fc.boolean(), { maxLength: 12 }),
        // Arbitrary optional-* checks that must not matter.
        fc.array(optionalCheckArb, { maxLength: 12 }),
        (otherRequiredOks, optionalChecks) => {
          const otherRequired: DoctorCheck[] = otherRequiredOks.map((ok, i) => ({
            name: `req-${i}`,
            ok,
            category: 'required-install',
          }));
          // Guarantee at least one failing required-install check.
          const failing: DoctorCheck = {
            name: 'failing-required',
            ok: false,
            category: 'required-install',
          };
          const checks: DoctorCheck[] = [...otherRequired, failing, ...optionalChecks];

          const badge = summaryBadge(checks);
          expect(badge.ok).toBe(false);
          expect(badge.text).toBe('Action required');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('ignores optional-* checks: adding failing optional checks never changes the badge', () => {
    fc.assert(
      fc.property(
        checksArb,
        // Extra optional-* checks, all failing, to prove they are ignored by
        // the badge computation.
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 24 }),
            category: fc.constantFrom(...OPTIONAL_CATEGORIES),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        (baseChecks, extraOptionalSpecs) => {
          const before = summaryBadge(baseChecks);

          const failingOptionals: DoctorCheck[] = extraOptionalSpecs.map((spec) => ({
            name: spec.name,
            ok: false,
            category: spec.category,
          }));
          const after = summaryBadge([...baseChecks, ...failingOptionals]);

          // The badge is identical before and after adding failing optionals.
          expect(after.text).toBe(before.text);
          expect(after.ok).toBe(before.ok);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('reads "0/0 OK" with ok=true when there are no required-install checks', () => {
    expect(summaryBadge([])).toEqual({ text: '0/0 OK', ok: true });
    expect(
      summaryBadge([
        { name: 'opt', ok: false, category: 'optional-install' },
        { name: 'proc', ok: false, category: 'optional-process' },
      ]),
    ).toEqual({ text: '0/0 OK', ok: true });
  });
});
