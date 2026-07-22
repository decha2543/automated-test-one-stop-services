import { SEVERITY_LEVELS, type SeverityLevel } from './tags.js';

// ===========================================================================
// Severity-weighted pass score — shared by the report service (which builds
// the per-severity tally from a runner's result file) and the client (which
// renders the weighted percentage). Framework-free like the rest of @hub/shared.
// ===========================================================================

/**
 * Weight per severity level for the weighted pass score. Business rule
 * (confirmed with the user): failing a more severe case costs proportionally
 * more, so `critical` outweighs `low` 4:1.
 */
export const SEVERITY_WEIGHTS: Record<SeverityLevel, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** Passed / failed tally for one severity level. */
export interface SeverityCount {
  passed: number;
  failed: number;
}

/**
 * Per-severity passed/failed tally for a report. Every level is always present
 * (absent levels are `{0, 0}`) so the UI renders a stable breakdown.
 */
export type SeverityBreakdown = Record<SeverityLevel, SeverityCount>;

/** A fresh, zeroed breakdown to accumulate into. */
export function emptySeverityBreakdown(): SeverityBreakdown {
  return {
    critical: { passed: 0, failed: 0 },
    high: { passed: 0, failed: 0 },
    medium: { passed: 0, failed: 0 },
    low: { passed: 0, failed: 0 },
  };
}

/**
 * Severity-weighted pass percentage:
 *   Σ(weight · passed) / Σ(weight · (passed + failed)) × 100
 *
 * Returns `null` when no case carries a severity (nothing to weight), so the
 * caller can fall back to a plain pass rate.
 */
export function weightedPassPercent(breakdown: SeverityBreakdown): number | null {
  let scored = 0;
  let total = 0;
  for (const level of SEVERITY_LEVELS) {
    const weight = SEVERITY_WEIGHTS[level];
    const { passed, failed } = breakdown[level];
    scored += weight * passed;
    total += weight * (passed + failed);
  }
  if (total === 0) return null;
  return (scored / total) * 100;
}
