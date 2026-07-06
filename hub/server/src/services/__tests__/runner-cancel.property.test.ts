import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runner } from '../runner.js';

/**
 * Property 13 — Cancel of non-active run is a safe no-op (R7.4).
 *
 * For any run id that is NOT present in the active list, `cancel(id)` returns
 * `false` (the "no active run found" indicator) and leaves the active list
 * untouched. The HTTP route layer then translates that `false` into a 404
 * NOT_FOUND response.
 *
 * The runner singleton has no runs started in this test, so `getActive()` is
 * empty. We additionally snapshot the active ids before each call and only
 * exercise ids that are not in that snapshot, so the property holds even if
 * the singleton somehow carried state. We assert both the return value and
 * that the active list is unchanged (same length AND same set of ids) across
 * the call.
 */

/** Set of active run ids currently tracked by the runner singleton. */
function activeIds(): Set<string> {
  return new Set(runner.getActive().map((r) => r.id));
}

/**
 * Generate candidate run ids spanning the realistic input space:
 *  - the empty string,
 *  - arbitrary unicode strings,
 *  - nanoid-shaped ids (alphanumeric + `_`/`-`, lengths up to the default 21,
 *    which includes the 10-char form `start()` uses).
 * Any id that happens to collide with a live active id is filtered out so the
 * property is only ever asserted for genuinely non-active ids.
 */
const nanoidAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const nanoidLikeArb: fc.Arbitrary<string> = fc.integer({ min: 1, max: 21 }).chain((len) =>
  fc
    .array(
      fc.integer({ min: 0, max: nanoidAlphabet.length - 1 }).map((i) => nanoidAlphabet[i]),
      { minLength: len, maxLength: len },
    )
    .map((chars) => chars.join('')),
);

const runIdArb: fc.Arbitrary<string> = fc.oneof(fc.constant(''), fc.string(), nanoidLikeArb);

describe('runner.cancel non-active run (Property 13)', () => {
  // Feature: one-stop-service-upgrade, Property 13: Cancel of non-active run is a safe no-op
  it('returns false and does not mutate the active list for any non-active run id', () => {
    fc.assert(
      fc.property(runIdArb, (id) => {
        const before = activeIds();
        // Only assert the property for ids that are genuinely not active.
        fc.pre(!before.has(id));

        const result = runner.cancel(id);

        const after = activeIds();

        // (i) cancel of a non-active id reports failure (route -> 404).
        expect(result).toBe(false);

        // (ii) the active list is unchanged: same size and same set of ids.
        expect(after.size).toBe(before.size);
        expect(after).toEqual(before);
      }),
      { numRuns: 100 },
    );
  });

  // Example cases pinning representative non-active ids (empty, random, nanoid-shaped).
  it.each([
    '',
    'not-a-real-run',
    'V1StGXR8_Z',
    'aaaaaaaaaaaaaaaaaaaaa',
    '   ',
  ])('cancel(%j) is false and leaves the active list unchanged (example)', (id) => {
    const before = activeIds();
    expect(before.has(id)).toBe(false);

    expect(runner.cancel(id)).toBe(false);

    expect(activeIds()).toEqual(before);
  });
});
