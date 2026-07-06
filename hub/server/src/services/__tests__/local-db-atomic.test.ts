import type { RunRecord, RunStatus } from '@hub/shared';
import { describe, expect, it } from 'vitest';
import { openLocalDb } from '../local-db.js';

/**
 * Edge-case tests — Local_DB atomic write + silent partial-write rollback.
 * These are example-based edge cases (NOT property tests): they inject a
 * deterministic mid-write failure and assert the all-or-nothing guarantee that
 * `writeCollection`/`appendHistory` provide via `BEGIN IMMEDIATE … COMMIT`
 * with `ROLLBACK` + rethrow on failure.
 *
 * Two failure points are exercised against the normalized schema:
 *   - kv_store path (`schedules` with no `.json` suffix → JSON fallback):
 *     `transact()` runs `BEGIN IMMEDIATE`, then `JSON.stringify(rows)`. A
 *     payload whose `toJSON()` throws fails AFTER BEGIN but BEFORE any DB
 *     mutation, so ROLLBACK unwinds an empty transaction (all-old). Rethrown
 *     to the caller (R12.4).
 *   - history path: `replaceAll` runs `DELETE FROM history` FIRST, then binds
 *     and INSERTs each record. A record with a non-scalar column value throws
 *     during its INSERT — AFTER real mutations (the DELETE and the first valid
 *     INSERT) — so ROLLBACK must undo them, restoring the prior committed
 *     state (all-old). The strongest demonstration of the atomic path
 *     (R12.3/R12.4).
 */

/** Build a valid, JSON-serializable RunRecord for history rows. */
function makeRecord(id: string, startedAt: string, status: RunStatus = 'passed'): RunRecord {
  return {
    id,
    request: { tool: 'playwright', type: 'e2e', project: 'demo', mode: 'local' },
    command: `run ${id}`,
    status,
    startedAt,
  };
}

/**
 * A record that fails to BIND mid-INSERT. The normalized history writer binds
 * each column as a scalar, so a non-scalar `command` makes node:sqlite throw
 * during the INSERT — after the DELETE and any earlier valid INSERT have run,
 * which is exactly the mid-transaction failure these tests need. (`id` /
 * `startedAt` stay valid so the writer's earlier reads succeed.)
 */
function makeUnbindableRecord(id: string, startedAt: string): RunRecord {
  const rec = makeRecord(id, startedAt);
  (rec as { command: unknown }).command = { not: 'a scalar' };
  return rec;
}

/** Stable order-insensitive comparison for history reads (ordered by DESC). */
function sortById<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}

describe('Local_DB atomic write — injected mid-write failure (R12.3/R12.4)', () => {
  it('kv_store: a write that fails during serialization leaves the previous value intact (all-old), then a successful write yields all-new', () => {
    const db = openLocalDb(':memory:');
    const name = 'schedules';

    // Commit a known ORIGINAL state.
    const original = [
      { id: 's1', cron: '* * * * *' },
      { id: 's2', cron: '0 0 * * *' },
    ];
    db.writeCollection(name, original);
    expect(db.readCollection(name)).toEqual(original);

    // Inject a payload whose `toJSON()` throws → JSON.stringify fails inside
    // the transaction (after BEGIN IMMEDIATE) → ROLLBACK + rethrow.
    const poison = [
      {
        id: 'boom',
        toJSON() {
          throw new Error('serialization failure injected mid-write');
        },
      },
    ];
    expect(() => db.writeCollection(name, poison)).toThrow(/serialization failure injected/);

    // R12.4: the failed write did NOT partially apply — read-back is exactly
    // the prior committed value (all-old), never partial/corrupt.
    expect(db.readCollection(name)).toEqual(original);

    // A subsequent successful overwrite yields all-new.
    const updated = [{ id: 's3', cron: '*/5 * * * *' }];
    db.writeCollection(name, updated);
    expect(db.readCollection(name)).toEqual(updated);
  });

  it('history: a failure AFTER real mutations (DELETE + first INSERT) rolls back to the prior committed state (all-old), then a successful write yields all-new', () => {
    const db = openLocalDb(':memory:');

    // Commit a known ORIGINAL history state (writeHistory DELETEs then inserts).
    const original = [
      makeRecord('r1', '2024-01-01T00:00:01.000Z'),
      makeRecord('r2', '2024-01-01T00:00:02.000Z'),
    ];
    db.writeCollection('history', original);
    expect(sortById(db.readCollection<RunRecord>('history'))).toEqual(sortById(original));

    // The failing write: a valid record FIRST (so DELETE + one INSERT actually
    // execute), then a circular record that throws mid-loop → ROLLBACK must
    // undo the DELETE and the first INSERT.
    const failingWrite = [
      makeRecord('new-valid', '2024-01-02T00:00:01.000Z'),
      makeUnbindableRecord('new-circular', '2024-01-02T00:00:02.000Z'),
    ];
    expect(() => db.writeCollection('history', failingWrite)).toThrow();

    // R12.3/R12.4: never partial. The half-applied DELETE+INSERT was rolled
    // back; read-back equals the ORIGINAL committed state (all-old). The
    // 'new-valid' record that was momentarily inserted did NOT survive.
    const afterFailure = db.readCollection<RunRecord>('history');
    expect(sortById(afterFailure)).toEqual(sortById(original));
    expect(afterFailure.some((r) => r.id === 'new-valid')).toBe(false);
    expect(afterFailure.some((r) => r.id === 'new-circular')).toBe(false);

    // A subsequent successful overwrite yields all-new (and only new).
    const updated = [
      makeRecord('r3', '2024-01-03T00:00:01.000Z'),
      makeRecord('r4', '2024-01-03T00:00:02.000Z'),
    ];
    db.writeCollection('history', updated);
    expect(sortById(db.readCollection<RunRecord>('history'))).toEqual(sortById(updated));
  });
});

describe('Local_DB silent partial-write rollback (R13.3)', () => {
  it('a buggy code path that partially writes a silent run then fails leaves NO record referencing that run', () => {
    const db = openLocalDb(':memory:');
    const silentRunId = 'silent-run-xyz';

    // Known committed state: normal (non-silent) history with NO reference to
    // the silent run id.
    const committed = [
      makeRecord('normal-1', '2024-05-01T00:00:01.000Z'),
      makeRecord('normal-2', '2024-05-01T00:00:02.000Z'),
    ];
    db.writeCollection('history', committed);
    const before = db.readCollection<RunRecord>('history');
    expect(before.some((r) => r.id === silentRunId)).toBe(false);

    // Simulate a code path that ATTEMPTS to write part of a silent run's data
    // (the silent record FIRST, so it gets inserted after the DELETE) and then
    // fails mid-way (a second silent-related record whose serialization throws).
    const partialSilentWrite = [
      makeRecord(silentRunId, '2024-05-02T00:00:01.000Z'),
      makeUnbindableRecord(`${silentRunId}-frag`, '2024-05-02T00:00:02.000Z'),
    ];
    expect(() => db.writeCollection('history', partialSilentWrite)).toThrow();

    // R13.3: the atomic ROLLBACK guarantees no partial silent record survives.
    // Querying by the silent run id returns 0 records, and the committed state
    // is unchanged (the prior state, which never contained the silent run).
    const after = db.readCollection<RunRecord>('history');
    const referencingSilentRun = after.filter(
      (r) => r.id === silentRunId || r.id.startsWith(silentRunId),
    );
    expect(referencingSilentRun).toHaveLength(0);
    expect(sortById(after)).toEqual(sortById(committed));
  });

  it('appendHistory of a non-serializable silent record rolls back, leaving the store free of that run', () => {
    const db = openLocalDb(':memory:');
    const silentRunId = 'silent-append-1';

    // Pre-existing committed history, none referencing the silent run.
    const committed = [makeRecord('keep-1', '2024-06-01T00:00:01.000Z')];
    db.writeCollection('history', committed);

    // appendHistory wraps INSERT + trim in a transaction; an unbindable record
    // makes the INSERT throw → ROLLBACK + rethrow.
    const circular = makeUnbindableRecord(silentRunId, '2024-06-02T00:00:01.000Z');
    expect(() => db.appendHistory(circular)).toThrow();

    // No row references the silent run; committed state untouched.
    const after = db.readCollection<RunRecord>('history');
    expect(after.some((r) => r.id === silentRunId)).toBe(false);
    expect(sortById(after)).toEqual(sortById(committed));
  });
});
