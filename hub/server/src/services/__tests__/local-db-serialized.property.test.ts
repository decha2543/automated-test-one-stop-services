import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openLocalDb } from '../local-db.js';

/**
 * Property 25 — Serialized writes never expose partial state (R12.5).
 *
 * `DatabaseSync` is a synchronous API, so `writeCollection` calls serialize by
 * invocation order: each `BEGIN IMMEDIATE … COMMIT` transaction completes
 * fully before the next one begins, with no interleaving. We assert the
 * observable consequence:
 *
 *   (i)  After applying a sequence of writes state_0 … state_n to one
 *        collection, a read taken immediately after write i returns EXACTLY
 *        state_i (the full collection — never a partial or interleaved mix),
 *        and the final read equals the last written state.
 *   (ii) When writes to TWO different collection names are interleaved, each
 *        collection reflects only its OWN most-recent write — there is no
 *        cross-contamination between the two write streams.
 *
 * `readCollection` parses the stored JSON blob then `structuredClone`s it, so
 * the oracle is `JSON.parse(JSON.stringify(state))` of what was written (the
 * canonical "stored" form), matching the JSON round-trip Local_DB performs.
 */

/**
 * Arbitrary JSON-serializable value (no NaN / Infinity / undefined so the
 * value survives a JSON round-trip unchanged). Bounded depth keeps generation
 * cheap while still producing nested objects and arrays.
 */
const jsonValueArb: fc.Arbitrary<unknown> = fc.letrec<{ value: unknown }>((tie) => ({
  value: fc.oneof(
    { maxDepth: 3 },
    fc.boolean(),
    fc.integer(),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.string(),
    fc.constant(null),
    fc.array(tie('value'), { maxLength: 4 }),
    fc.dictionary(fc.string(), tie('value'), { maxKeys: 4 }),
  ),
})).value;

/** A "row" is a nested object; a collection-state is an array of such rows. */
const rowArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(fc.string(), jsonValueArb, {
  maxKeys: 5,
});
const collectionArb: fc.Arbitrary<Record<string, unknown>[]> = fc.array(rowArb, { maxLength: 6 });

/** The exact form Local_DB stores and hands back (JSON round-trip, deep cloned). */
function storedForm<T>(rows: T[]): T[] {
  return JSON.parse(JSON.stringify(rows)) as T[];
}

describe('openLocalDb serialized writes (Property 25)', () => {
  // Feature: one-stop-service-upgrade, Property 25: Serialized writes never expose partial state
  it('a sequence of writes to one collection always reads back the full last-written state', () => {
    let counter = 0;
    fc.assert(
      fc.property(
        // At least two writes so we exercise overwrite/serialization, not just a single write.
        fc.array(collectionArb, { minLength: 2, maxLength: 8 }),
        (states) => {
          const db = openLocalDb(':memory:');
          const name = `coll_${counter++}`;

          // Apply each state in order; after every write the read must equal
          // exactly that state — never a partial mix of earlier/later writes.
          for (const state of states) {
            const expected = storedForm(state);
            db.writeCollection(name, state);
            const read = db.readCollection<Record<string, unknown>>(name);
            expect(read).toEqual(expected);
          }

          // The final persisted value equals the last fully-written state.
          const last = states[states.length - 1] as Record<string, unknown>[];
          expect(db.readCollection<Record<string, unknown>>(name)).toEqual(storedForm(last));
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: one-stop-service-upgrade, Property 25: Serialized writes never expose partial state
  it('interleaved writes to two collections never cross-contaminate (each reflects only its own last write)', () => {
    let counter = 0;
    fc.assert(
      fc.property(
        // A sequence of operations, each targeting collection A (false) or B (true).
        fc.array(fc.tuple(fc.boolean(), collectionArb), { minLength: 2, maxLength: 12 }),
        (ops) => {
          // Require at least one write to each collection so the no-cross-
          // contamination claim is actually exercised.
          fc.pre(ops.some(([toB]) => toB) && ops.some(([toB]) => !toB));

          const db = openLocalDb(':memory:');
          const nameA = `collA_${counter}`;
          const nameB = `collB_${counter}`;
          counter++;

          // Track the canonical last-written state for each collection.
          let lastA: Record<string, unknown>[] | undefined;
          let lastB: Record<string, unknown>[] | undefined;

          for (const [toB, state] of ops) {
            const name = toB ? nameB : nameA;
            const expected = storedForm(state);
            db.writeCollection(name, state);

            // The just-written collection reads back exactly its own state.
            expect(db.readCollection<Record<string, unknown>>(name)).toEqual(expected);

            if (toB) lastB = expected;
            else lastA = expected;

            // The OTHER collection still reflects only its own last write
            // (or [] if never written) — no interleaving across streams.
            if (toB) {
              expect(db.readCollection<Record<string, unknown>>(nameA)).toEqual(lastA ?? []);
            } else {
              expect(db.readCollection<Record<string, unknown>>(nameB)).toEqual(lastB ?? []);
            }
          }

          // Final reads: each collection reflects exactly its own last write.
          expect(db.readCollection<Record<string, unknown>>(nameA)).toEqual(lastA ?? []);
          expect(db.readCollection<Record<string, unknown>>(nameB)).toEqual(lastB ?? []);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Concrete example pinning the "full last state, never partial" contract.
  it('overwriting a larger collection with a smaller one reads back only the smaller (example)', () => {
    const db = openLocalDb(':memory:');
    db.writeCollection('seq', [{ a: 1 }, { b: 2 }, { c: 3 }]);
    expect(db.readCollection('seq')).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);

    db.writeCollection('seq', [{ z: 99 }]);
    // No leftover rows from the previous, larger write — the full new state only.
    expect(db.readCollection('seq')).toEqual([{ z: 99 }]);
  });

  // Concrete example pinning the no-cross-contamination contract.
  it('two collections keep independent last-written states (example)', () => {
    const db = openLocalDb(':memory:');
    db.writeCollection('alpha', [{ a: 1 }]);
    db.writeCollection('beta', [{ b: 1 }]);
    db.writeCollection('alpha', [{ a: 2 }]);

    expect(db.readCollection('alpha')).toEqual([{ a: 2 }]);
    expect(db.readCollection('beta')).toEqual([{ b: 1 }]);
  });
});
