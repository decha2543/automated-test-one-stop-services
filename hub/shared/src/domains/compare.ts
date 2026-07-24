import type { RunStatus } from './runs.js';

/** Pass/fail outcome of a single test within a run. */
export type TestStatus = 'passed' | 'failed';

/** How a test's outcome changed from run A (baseline) to run B (target). */
export type CompareCategory =
  | 'newlyFailed' // passed in A, failed in B  (a regression)
  | 'fixed' // failed in A, passed in B
  | 'stillFailing' // failed in both
  | 'stillPassing' // passed in both
  | 'added' // present only in B
  | 'removed'; // present only in A

/** One test's line in the A vs B comparison. */
export interface CompareRow {
  /** Stable per-test id (Playwright spec id); falls back to `file::title`. */
  key: string;
  title: string;
  /** Spec file the test lives in, for grouping/display. */
  file?: string;
  category: CompareCategory;
  /** Outcome in run A. Absent when the test exists only in B. */
  a?: TestStatus;
  /** Outcome in run B. Absent when the test exists only in A. */
  b?: TestStatus;
}

/** Summary of one side of the comparison. */
export interface CompareSide {
  runId: string;
  tool: string;
  project: string;
  startedAt: string;
  status: RunStatus;
  /** Totals parsed from this run's per-test result file. */
  total: number;
  passed: number;
  failed: number;
}

/** Result of comparing two runs' per-test outcomes. */
export interface RunCompareResult {
  a: CompareSide;
  b: CompareSide;
  rows: CompareRow[];
  counts: Record<CompareCategory, number>;
  /**
   * True when one or both runs had no parseable per-test result file (e.g. a
   * non-Playwright tool, a silent run, or aged-out artifacts), so the per-test
   * diff could not be computed. The side summaries still carry run metadata.
   */
  unavailable: boolean;
}
