import { dayjs } from './dayjs.js';

/**
 * Canonical run/report timestamp formatters.
 *
 * The History and Reports tables both render timestamps through these helpers
 * so the SAME instant always shows the SAME text everywhere. Reports are
 * aligned to history (the source of truth): the server now emits report
 * timestamps as ISO-8601 strings — identical in shape to a run's `startedAt`.
 *
 * All inputs are ISO-8601 strings; dayjs renders them in the viewer's local
 * timezone. A missing or unparseable value renders as `-` rather than the
 * literal "Invalid Date".
 */

/** Absolute local time, e.g. `2026-06-16 10:00:00`. */
export function formatAbsolute(iso: string | undefined | null): string {
  if (!iso) return '-';
  const d = dayjs(iso);
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm:ss') : '-';
}

/** Relative local time, e.g. `2 hours ago`. */
export function formatRelative(iso: string | undefined | null): string {
  if (!iso) return '-';
  const d = dayjs(iso);
  return d.isValid() ? d.fromNow() : '-';
}
