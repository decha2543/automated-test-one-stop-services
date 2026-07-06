import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openLocalDb } from '../local-db.js';

/**
 * Property 24 — Local_DB read isolation (deep clone) (R12.2).
 *
 * For any collection written to Local_DB, reading it back returns a deep clone:
 *   (i)  mutating the returned copy does NOT affect internally stored data
 *        (a later fresh read still returns the originally-stored value), and
 *   (ii) later internal changes (re-writing the collection) do NOT affect a
 *        copy that was returned before the change.
 *
 * `readCollection` parses the stored JSON blob then `structuredClone`s it, so a
 * read is content-equal to `JSON.parse(JSON.stringify(rows))` of what was
 * written. We compare against that canonical "stored" form rather than the raw
 * arbitrary so the oracle matches the JSON round-trip Local_DB performs.
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

/** A "row" is a nested object; a collection is an array of such rows. */
const rowArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(fc.string(), jsonValueArb, {
  maxKeys: 5,
});
const collectionArb: fc.Arbitrary<Record<string, unknown>[]> = fc.array(rowArb, { maxLength: 6 });

/** The exact form Local_DB stores and hands back (JSON round-trip, deep cloned). */
function storedForm<T>(rows: T[]): T[] {
  return JSON.parse(JSON.stringify(rows)) as T[];
}

/**
 * Deeply mutate a value in place: append to every array, add a marker key to
 * every object, and recurse. Guarantees at least one change for any array or
 * object (including empty ones). Primitives are left as-is (cannot mutate).
 */
function deepMutate(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) deepMutate(item);
    value.push('__leaked_mutation__');
  } else if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) deepMutate(obj[key]);
    obj.__leaked_mutation__ = true;
  }
}

describe('openLocalDb read isolation (Property 24)', () => {
  // Feature: one-stop-service-upgrade, Property 24: Local_DB read isolation (deep clone)
  it('mutating a returned copy never affects internally stored data', () => {
    let counter = 0;
    fc.assert(
      fc.property(collectionArb, (rows) => {
        // Fresh DB per run keeps collections isolated from one another.
        const db = openLocalDb(':memory:');
        const name = `coll_${counter++}`;
        const original = storedForm(rows);

        db.writeCollection(name, rows);

        const copy = db.readCollection<Record<string, unknown>>(name);
        expect(copy).toEqual(original);

        // Deeply mutate the returned copy; internal state must be untouched.
        deepMutate(copy);

        const fresh = db.readCollection<Record<string, unknown>>(name);
        expect(fresh).toEqual(original);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: one-stop-service-upgrade, Property 24: Local_DB read isolation (deep clone)
  it('a previously returned copy is unaffected by later internal writes (and by mutating a newer copy)', () => {
    let counter = 0;
    fc.assert(
      fc.property(collectionArb, collectionArb, (rows1, rows2) => {
        const db = openLocalDb(':memory:');
        const name = `coll_${counter++}`;
        const stored1 = storedForm(rows1);
        const stored2 = storedForm(rows2);

        db.writeCollection(name, rows1);

        // copyA captured BEFORE the next write.
        const copyA = db.readCollection<Record<string, unknown>>(name);
        expect(copyA).toEqual(stored1);

        // Later internal change: re-write the same collection.
        db.writeCollection(name, rows2);

        // copyB reflects the new state; mutate it deeply.
        const copyB = db.readCollection<Record<string, unknown>>(name);
        expect(copyB).toEqual(stored2);
        deepMutate(copyB);

        // copyA, returned before the write, must still equal the original state.
        expect(copyA).toEqual(stored1);

        // And the internal store reflects the second write, uncorrupted by the
        // mutation applied to copyB.
        const fresh = db.readCollection<Record<string, unknown>>(name);
        expect(fresh).toEqual(stored2);
      }),
      { numRuns: 200 },
    );
  });

  // Concrete examples pinning the two-directional isolation contract.
  it('isolates nested structures (example)', () => {
    const db = openLocalDb(':memory:');
    const rows = [{ a: [1, { b: 2 }], c: { d: [3] } }];
    db.writeCollection('example', rows);

    const copy = db.readCollection<(typeof rows)[number]>('example');
    // Mutate deeply nested members of the returned copy.
    const copyRow = copy[0] as (typeof rows)[number];
    (copyRow.a as unknown[]).push(99);
    ((copyRow.a as unknown[])[1] as Record<string, unknown>).b = 999;
    ((copyRow.c as Record<string, unknown[]>).d as unknown[]).push(42);

    expect(db.readCollection('example')).toEqual([{ a: [1, { b: 2 }], c: { d: [3] } }]);
  });

  it('source array passed to writeCollection is decoupled from internal state (example)', () => {
    const db = openLocalDb(':memory:');
    const source = [{ x: 1 }];
    db.writeCollection('decouple', source);

    // Mutating the caller's source array after writing must not leak in.
    source.push({ x: 2 });
    (source[0] as Record<string, unknown>).x = 100;

    expect(db.readCollection('decouple')).toEqual([{ x: 1 }]);
  });
});
