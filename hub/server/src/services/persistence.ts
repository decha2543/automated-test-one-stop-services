import { getDb } from './db.js';

/**
 * Generic JSON persistence facade.
 *
 * The backing store is now the embedded Local_DB (node:sqlite) shared via
 * `getDb()` — NOT the old `<name>.json` files. The PUBLIC API is unchanged
 * (`loadJson` / `saveJson` / `flushPersistence`) so scheduler, webhooks,
 * env-profiles, bookmarks, retention, matrix-runner, k6-trends, flaky-detector,
 * annotations, dashboard-layout and export-import keep working without any
 * contract changes.
 *
 * Each dataset `name` (for example `schedules.json`) is routed by the Local_DB
 * layer to a NORMALIZED table (typed columns per field) when one exists, or to
 * a JSON document in `kv_store` for secondary/deeply-nested datasets. Payloads
 * may be arrays (collections) or plain objects (single documents); the
 * per-domain repositories map them to/from columns. This facade keeps the
 * `loadJson`/`saveJson` contract unchanged so callers need no edits.
 *
 * Semantics preserved from the file-based layer:
 *   - Isolation (R12.2): `loadJson` hands back a deep clone — `readDoc` already
 *     `structuredClone`s the stored value, and `saveJson` serialises the
 *     payload synchronously so later caller mutations cannot leak into the DB.
 *   - Atomic writes (R12.3/12.4): `writeCollection` wraps `BEGIN IMMEDIATE …
 *     COMMIT` and rolls back + rethrows on failure.
 *   - Serialized per-store writes (R12.5): `DatabaseSync` runs synchronously on
 *     the main thread, so writes are serialised by call order with no
 *     interleaving — the old per-file write queue is no longer needed.
 *   - Read-after-write consistency: `saveJson` commits synchronously, so a
 *     subsequent `loadJson` observes the new value without any in-memory cache.
 */

/**
 * Deep-clone a payload before handing it to a caller. Uses `structuredClone`
 * and falls back to a JSON round-trip for any value structuredClone refuses
 * (such values should never appear in our persisted JSON anyway).
 */
function clone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

/**
 * Synchronous read used during constructor wiring (runner/scheduler load their
 * state before the event loop starts). Safe because `getDb()` opens the
 * Local_DB synchronously with a fully-prepared schema (R12.1).
 *
 * Returns a deep clone so callers cannot mutate the stored value. When the
 * dataset is absent, a clone of `fallback` is returned.
 */
export function loadJson<T>(name: string, fallback: T): T {
  const stored = getDb().readDoc<T>(name);
  if (stored === undefined) return clone(fallback);
  // `readDoc` already returns an isolated deep clone.
  return stored;
}

/**
 * Persist atomically. The payload is serialised synchronously inside a single
 * transaction, so future `loadJson` calls always see a consistent snapshot —
 * even if the caller mutates the array/object after `saveJson` returns. Writes
 * to the same store are serialised by call order (R12.5).
 *
 * The payload may be an array or a plain object; `writeCollection` serialises
 * whatever it is given, so we cast through `unknown[]` to satisfy its
 * collection-oriented signature without changing runtime behaviour.
 */
export function saveJson<T>(name: string, data: T): void {
  getDb().writeCollection(name, data as unknown as unknown[]);
}

/**
 * Force-flush all pending writes. node:sqlite writes are synchronous and are
 * already committed by the time `saveJson` returns, so there is nothing to
 * await. Kept async to preserve the public contract used by graceful-shutdown
 * handlers and test teardown.
 */
export async function flushPersistence(): Promise<void> {
  // No-op: writes are committed synchronously.
}
