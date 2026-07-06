import type { DoctorCategory, DoctorCheck } from '@hub/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DOCTOR_CATEGORY_ORDER, groupByCategory, shouldShowGroup } from '../doctor-panel-helpers';

/**
 * Property test for Task 2.7 — DoctorPanel category partition.
 *
 * Validates: Requirements 3.2, 3.3, 3.6
 */

/** The three valid Doctor categories a generated check may be drawn from. */
const categoryArb: fc.Arbitrary<DoctorCategory> = fc.constantFrom(
  'required-install',
  'optional-install',
  'optional-process',
);

/**
 * Smart generator for a single {@link DoctorCheck}: a name, an `ok` boolean,
 * optional `version`/`hint`, and a category constrained to the 3 valid values.
 * Each generated object is a fresh reference, so reference identity uniquely
 * tracks a check across the partition.
 */
const checkArb: fc.Arbitrary<DoctorCheck> = fc.record({
  name: fc.string(),
  ok: fc.boolean(),
  version: fc.option(fc.string(), { nil: undefined }),
  hint: fc.option(fc.string(), { nil: undefined }),
  category: categoryArb,
});

const checksArb: fc.Arbitrary<DoctorCheck[]> = fc.array(checkArb, { maxLength: 50 });

describe('groupByCategory — DoctorPanel category partition', () => {
  it('partitions losslessly into exactly the 3 fixed groups, preserving per-category order', () => {
    // Feature: one-stop-service-upgrade, Property 4: DoctorPanel category partition is lossless
    fc.assert(
      fc.property(checksArb, (checks) => {
        const groups = groupByCategory(checks);

        // Exactly the 3 fixed groups exist, in the fixed render order.
        expect(Object.keys(groups).sort()).toEqual([...DOCTOR_CATEGORY_ORDER].sort());

        const grouped = DOCTOR_CATEGORY_ORDER.map((category) => groups[category]);

        // Conservation: summed group sizes equal the input length (nothing
        // dropped or duplicated).
        const totalGrouped = grouped.reduce((sum, group) => sum + group.length, 0);
        expect(totalGrouped).toBe(checks.length);

        for (const category of DOCTOR_CATEGORY_ORDER) {
          const group = groups[category];

          // Every member of a group actually belongs to that category.
          for (const check of group) {
            expect(check.category).toBe(category);
          }

          // Within-group order is preserved: the group equals the input
          // filtered to that category, element-by-element, by reference.
          const expected = checks.filter((check) => check.category === category);
          expect(group).toEqual(expected);
          expect(group.length).toBe(expected.length);
          for (let i = 0; i < group.length; i += 1) {
            expect(group[i]).toBe(expected[i]);
          }

          // shouldShowGroup is true iff the group is non-empty.
          expect(shouldShowGroup(group)).toBe(group.length > 0);
        }

        // No check appears in more than one group: the groups are pairwise
        // disjoint by reference and their union is exactly the input set.
        const seen = new Set<DoctorCheck>();
        let unionSize = 0;
        for (const group of grouped) {
          for (const check of group) {
            expect(seen.has(check)).toBe(false);
            seen.add(check);
            unionSize += 1;
          }
        }
        expect(unionSize).toBe(checks.length);
        for (const check of checks) {
          expect(seen.has(check)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
