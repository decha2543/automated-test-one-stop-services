import type { RunRecord } from '@hub/shared';
import { getDb } from './db.js';

/**
 * Run-history store.
 *
 * The backing store is now the embedded Local_DB (node:sqlite) shared via
 * `getDb()` — NOT the old `history.ndjson` / `history.json` files. The PUBLIC
 * API is unchanged (`append` / `getAll` / `clear` / `flush`) so the runner
 * keeps working without any contract changes.
 *
 * Storage: every record lives in the dedicated, NORMALIZED `history` table —
 * one row per RunRecord with typed columns (status, command, timestamps,
 * exit_code, report_path, and the flattened `req_*` request columns). Reads
 * come back ordered newest first; `appendHistory` inserts then trims to
 * MAX_HISTORY=200 (R12.6).
 *
 * Silent runs: the no-trace gate lives entirely in the runner (Area C). The
 * runner only calls `historyStore.append` for NON-silent runs, so a silent run
 * never reaches this store and never touches Local_DB (R13.1/R13.2). This file
 * deliberately adds NO silent-specific logic — it simply persists whatever it
 * is given.
 */
class HistoryStore {
  /**
   * Get all records (newest first, capped at MAX_HISTORY).
   * `readCollection('history')` returns rows ordered by `started_at DESC` as a
   * deep clone (R12.2).
   */
  getAll(): RunRecord[] {
    return getDb().readCollection<RunRecord>('history');
  }

  /**
   * Append a finished run record. `appendHistory` inserts inside a transaction
   * then trims the table back to the newest MAX_HISTORY=200 records (R12.6).
   *
   * Only called for non-silent runs (the runner gates this) — see class docs.
   */
  append(record: RunRecord): void {
    getDb().appendHistory(record);
  }

  /** Clear all history (manual user action) by writing an empty collection. */
  clear(): void {
    getDb().writeCollection<RunRecord>('history', []);
  }

  /**
   * Force flush (for graceful shutdown). node:sqlite writes are synchronous and
   * already committed by the time `append`/`clear` return, so there is nothing
   * to await. Kept async to preserve the public contract.
   */
  async flush(): Promise<void> {
    // No-op: writes are committed synchronously.
  }
}

export const historyStore = new HistoryStore();
