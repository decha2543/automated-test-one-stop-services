import { LOCAL_DB_PATH } from '../config.js';
import { type LocalDb, openLocalDb } from './local-db.js';

/**
 * Process-wide Local_DB singleton (Area E).
 *
 * `persistence.ts` and `history-store.ts` are rewired to call into this one
 * shared `LocalDb` instead of reading/writing JSON/NDJSON files directly. We
 * open it lazily on first access so that:
 *   - the database is created (schema prepared) even when empty, and
 *   - boot-time reads are synchronous (R12.1) — `getDb()` returns a fully
 *     prepared `LocalDb` the very first time persistence/history touch it,
 *     which happens during module construction before the event loop starts.
 *
 * The DB path comes from `LOCAL_DB_PATH` (config), defaulting to
 * `hub/server/data/hub.db`. Tests set `HUB_DB_PATH=':memory:'` for isolation.
 */
let instance: LocalDb | undefined;

/** Get (opening on first use) the shared Local_DB instance. */
export function getDb(): LocalDb {
  if (!instance) {
    instance = openLocalDb(LOCAL_DB_PATH);
  }
  return instance;
}

/**
 * Replace the shared instance. Intended for tests that need a fresh in-memory
 * database between cases. Passing `undefined` clears it so the next `getDb()`
 * re-opens from `LOCAL_DB_PATH`.
 */
export function setDb(db: LocalDb | undefined): void {
  instance = db;
}
