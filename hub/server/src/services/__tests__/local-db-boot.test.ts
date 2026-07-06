import { rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RunRecord } from '@hub/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openLocalDb } from '../local-db.js';

/**
 * Local_DB boot + silent persistence unit tests (Area E).
 *
 * Covers two acceptance criteria at the persistence layer:
 *   - R12.1 boot-time synchronous load: openLocalDb on a FILE DB that already
 *     contains data returns a usable LocalDb whose first read immediately
 *     returns the persisted data synchronously (no await / no Promise).
 *   - R13.5 / R13.6 reopen after a silent run has no record: a silent run never
 *     writes (the runner gates the write — covered by task 5.3), so the
 *     persistence layer never holds a record referencing that run id, neither
 *     immediately (R13.5) nor after a reopen that simulates a Hub restart
 *     (R13.6). Non-silent records persist across the reopen.
 *
 * These exercise a real on-disk SQLite file (not ':memory:') so the
 * close/reopen round-trip genuinely re-reads persisted state.
 */

/** Build a minimal valid RunRecord with a unique id / ordered startedAt. */
function makeRecord(id: string, offsetSeconds: number): RunRecord {
  const base = Date.UTC(2024, 0, 1, 0, 0, 0);
  return {
    id,
    request: { tool: 'playwright', type: 'web', project: 'demo', mode: 'local' },
    command: `pw test ${id}`,
    status: 'passed',
    startedAt: new Date(base + offsetSeconds * 1000).toISOString(),
  };
}

describe('openLocalDb boot + silent persistence', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'local-db-boot-'));
    dbPath = path.join(tmpDir, 'hub.sqlite');
  });

  afterEach(() => {
    // Best-effort, NON-blocking cleanup. node:sqlite's DatabaseSync keeps a
    // file lock open (openLocalDb exposes no close hook), so on Windows the
    // .sqlite file stays locked (EBUSY) until the process exits. A retrying
    // delete would block until timeout, so we attempt one synchronous removal
    // and immediately swallow any error — a leftover temp file under
    // os.tmpdir() must never fail the assertions, and the OS reclaims it.
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Locked by node:sqlite; released on process exit.
    }
  });

  // R12.1 — boot-time synchronous load.
  it('reads persisted data synchronously on the first call after reopen (R12.1)', () => {
    // Seed a file-backed DB with several datasets, then "shut down" (drop the ref).
    const schedules = [
      { id: 's1', cron: '0 * * * *', config: { tool: 'playwright' } },
      { id: 's2', cron: '*/5 * * * *', config: { tool: 'k6' } },
    ];
    const bookmarks = [{ id: 'b1', name: 'smoke', config: { tool: 'robot' } }];
    const history = [makeRecord('run-a', 1), makeRecord('run-b', 2)];

    const seed = openLocalDb(dbPath);
    seed.writeCollection('schedules', schedules);
    seed.writeCollection('bookmarks', bookmarks);
    for (const rec of history) seed.appendHistory(rec);

    // Reopen the SAME file path — simulates a Hub restart / boot-time load.
    const booted = openLocalDb(dbPath);

    // The very FIRST read must return the persisted value directly, with no
    // await: the API is synchronous and the schema/data are ready before
    // openLocalDb returns (R12.1).
    const firstRead = booted.readCollection('schedules');
    expect(firstRead).not.toBeInstanceOf(Promise);
    expect((firstRead as { then?: unknown }).then).toBeUndefined();
    expect(firstRead).toEqual(schedules);

    // Subsequent reads of other datasets are equally available immediately.
    expect(booted.readCollection('bookmarks')).toEqual(bookmarks);
    expect(booted.readCollection<RunRecord>('history').map((r) => r.id)).toEqual([
      'run-b',
      'run-a',
    ]);
  });

  it('returns an empty collection synchronously for an absent dataset on a fresh file DB (R12.1)', () => {
    const booted = openLocalDb(dbPath);
    const result = booted.readCollection('schedules');
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toEqual([]);
  });

  // R13.5 / R13.6 — a silent run leaves no record, even after reopen.
  it('shows no record for a silent run id after reopen while non-silent records persist (R13.5/R13.6)', () => {
    const silentRunId = 'run-silent';
    const nonSilentIds = ['run-normal-1', 'run-normal-2'];

    const seed = openLocalDb(dbPath);
    // The runner gates writes for silent runs: only NON-silent history is
    // appended. The silent run's record is never written (mirrors task 5.3).
    seed.appendHistory(makeRecord(nonSilentIds[0] as string, 1));
    seed.appendHistory(makeRecord(nonSilentIds[1] as string, 2));
    // DO NOT append the silent run's record.

    // R13.5: immediately (no restart) the silent id is absent on the same handle.
    const beforeReopen = seed.readCollection<RunRecord>('history').map((r) => r.id);
    expect(beforeReopen).not.toContain(silentRunId);
    expect(beforeReopen).toEqual(expect.arrayContaining(nonSilentIds));

    // R13.6: reopen (simulated Hub restart) — silent id still absent, others persist.
    const booted = openLocalDb(dbPath);
    const persistedIds = booted.readCollection<RunRecord>('history').map((r) => r.id);

    expect(persistedIds).not.toContain(silentRunId);
    expect(persistedIds).toEqual(expect.arrayContaining(nonSilentIds));
    expect(persistedIds).toHaveLength(nonSilentIds.length);
  });

  it('keeps a silent run id absent from every dataset after reopen (R13.6)', () => {
    const silentRunId = 'run-silent-x';

    const seed = openLocalDb(dbPath);
    // Non-silent run is recorded in history; a kv collection holds an unrelated
    // last-status index entry. Neither references the silent run id.
    seed.appendHistory(makeRecord('run-kept', 1));
    seed.writeCollection('last-status', [
      { key: 'playwright/web/demo', status: 'passed', runId: 'run-kept' },
    ]);

    const booted = openLocalDb(dbPath);

    // Query the silent run id across the datasets a run could touch — all 0.
    const historyHits = booted
      .readCollection<RunRecord>('history')
      .filter((r) => r.id === silentRunId);
    const lastStatusHits = booted
      .readCollection<{ runId: string }>('last-status')
      .filter((r) => r.runId === silentRunId);

    expect(historyHits).toHaveLength(0);
    expect(lastStatusHits).toHaveLength(0);
  });
});
