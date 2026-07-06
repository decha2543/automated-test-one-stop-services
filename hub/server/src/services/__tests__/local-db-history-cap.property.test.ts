import type { RunRecord } from '@hub/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_HISTORY, openLocalDb } from '../local-db.js';

/**
 * Property 26 — History capped at MAX_HISTORY (R12.6).
 *
 * After appending any number of history records, the stored history never
 * exceeds MAX_HISTORY (200) records, and the retained records are exactly the
 * newest MAX_HISTORY by `startedAt` (the oldest are dropped).
 *
 * `appendHistory` inserts then trims via
 * `DELETE FROM history WHERE id NOT IN (… ORDER BY started_at DESC LIMIT 200)`,
 * and `readCollection('history')` returns rows ordered by `started_at DESC`.
 *
 * We generate DISTINCT `startedAt` values so the "newest 200" set is well
 * defined (no `started_at` ties → SQLite's `ORDER BY … LIMIT` is
 * deterministic). With distinct timestamps the final retained set is the
 * global newest `min(N, MAX_HISTORY)` records regardless of insertion order:
 * any record in the global top-200 is also in the top-200 of every prefix that
 * contains it, so it is never trimmed prematurely.
 */

/** Fixed UTC base so generated ISO timestamps are fixed-width and comparable. */
const BASE_MS = Date.UTC(2024, 0, 1, 0, 0, 0);

/**
 * Build a minimal valid RunRecord. `index` makes the id unique within a run;
 * `offsetSeconds` (distinct per record) makes `startedAt` unique and ordered.
 * `toISOString()` yields a fixed-width UTC string, so lexicographic order on
 * `startedAt` matches chronological order — exactly what the `started_at`
 * column ordering relies on.
 */
function makeRecord(index: number, offsetSeconds: number): RunRecord {
  return {
    id: `run-${index}`,
    request: { tool: 'playwright', type: 'web', project: 'demo', mode: 'local' },
    command: `pw test --run ${index}`,
    status: 'passed',
    startedAt: new Date(BASE_MS + offsetSeconds * 1000).toISOString(),
  };
}

/**
 * Generate exactly N (1..300) DISTINCT second-offsets in arbitrary order.
 * N spans from well below MAX_HISTORY to well above it (~1/3 of runs exceed the
 * cap), and the array order is the (varied) insertion order. The huge range
 * keeps uniqueness cheap to satisfy.
 */
const offsetsArb: fc.Arbitrary<number[]> = fc
  .integer({ min: 1, max: 300 })
  .chain((n) =>
    fc.uniqueArray(fc.integer({ min: 0, max: 10_000_000 }), { minLength: n, maxLength: n }),
  );

/** Ids of the newest `cap` records by `startedAt` (oracle for the retained set). */
function expectedNewestIds(records: RunRecord[], cap: number): Set<string> {
  const newestFirst = [...records].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return new Set(newestFirst.slice(0, cap).map((r) => r.id));
}

describe('openLocalDb history cap (Property 26)', () => {
  // Feature: one-stop-service-upgrade, Property 26: History capped at MAX_HISTORY
  it('caps stored history at MAX_HISTORY and retains exactly the newest records', () => {
    fc.assert(
      fc.property(offsetsArb, (offsets) => {
        const db = openLocalDb(':memory:');
        const records = offsets.map((offset, i) => makeRecord(i, offset));

        for (const rec of records) db.appendHistory(rec);

        const stored = db.readCollection<RunRecord>('history');
        const cap = Math.min(records.length, MAX_HISTORY);

        // (i) Count never exceeds MAX_HISTORY; it is exactly min(N, MAX_HISTORY).
        expect(stored.length).toBe(cap);
        expect(stored.length).toBeLessThanOrEqual(MAX_HISTORY);

        // (ii) Retained set is exactly the newest `cap` records by startedAt
        //      (every older record is dropped when capped).
        const storedIds = new Set(stored.map((r) => r.id));
        expect(storedIds).toEqual(expectedNewestIds(records, cap));

        // (iii) readCollection('history') is ordered by startedAt DESC.
        for (let i = 1; i < stored.length; i++) {
          const prev = stored[i - 1] as RunRecord;
          const curr = stored[i] as RunRecord;
          expect(prev.startedAt >= curr.startedAt).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Example cases pinning the boundary around MAX_HISTORY (= 200).
  it.each([
    1,
    199,
    MAX_HISTORY,
    MAX_HISTORY + 1,
    300,
  ])('retains min(N, MAX_HISTORY) newest records for N=%i (example)', (n) => {
    const db = openLocalDb(':memory:');
    // startedAt strictly increases with index, so the newest are the highest indices.
    const records = Array.from({ length: n }, (_, i) => makeRecord(i, i));

    for (const rec of records) db.appendHistory(rec);

    const stored = db.readCollection<RunRecord>('history');
    const cap = Math.min(n, MAX_HISTORY);

    expect(stored.length).toBe(cap);
    // Newest cap records are the highest indices; ordered DESC by startedAt.
    const expectedIds = Array.from({ length: cap }, (_, i) => `run-${n - 1 - i}`);
    expect(stored.map((r) => r.id)).toEqual(expectedIds);
  });
});
