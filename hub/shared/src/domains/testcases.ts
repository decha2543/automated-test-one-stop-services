/** A test-case document discovered under a project (xlsx or csv). */
export interface TestCaseDoc {
  /** File basename, e.g. `ta_test-case.xlsx`. */
  name: string;
  /** Path relative to the project directory, for display / grouping. */
  relPath: string;
  /** Absolute path, passed back to the download / preview endpoints. */
  path: string;
  ext: 'xlsx' | 'csv';
  size: number;
}

/** Parsed contents of a CSV test-case document. */
export interface TestCaseCsv {
  headers: string[];
  rows: string[][];
  /** True when the file was truncated to the row cap. */
  truncated: boolean;
}

/** One worksheet of a parsed xlsx test-case document. */
export interface TestCaseSheet {
  name: string;
  rows: string[][];
}

/** Parsed contents of an xlsx test-case document (all worksheets). */
export interface TestCaseWorkbook {
  sheets: TestCaseSheet[];
  /** True when any worksheet was truncated to the row cap. */
  truncated: boolean;
}

/**
 * Result of syncing last-run status into a test-case doc's overlay. Rows are
 * matched by Test Case ID against the run's per-test ids (the `${caseId}: ...`
 * title prefix), so it only fills in where the doc id and the spec id agree.
 */
export interface TestCaseStatusSyncResult {
  grid: TestCaseGrid;
  /** Doc rows whose Test Case ID matched a run result and were updated. */
  matched: number;
  /** Total doc data rows considered. */
  total: number;
  /** ISO time of the run used, or null when no run was found. */
  runAt: string | null;
}

/** Editable grid for a test-case doc: one entry per sheet, rows[0] is the header row. */
export interface TestCaseGrid {
  sheets: TestCaseSheet[];
  /** True when served from a `.edited.json` overlay (local edits exist). */
  edited: boolean;
}

/** Payload to edit a single cell (rows[0] is the header, so `row` must be >= 1). */
export interface TestCaseEditRequest {
  path: string;
  sheet: number;
  row: number;
  col: number;
  value: string;
}
