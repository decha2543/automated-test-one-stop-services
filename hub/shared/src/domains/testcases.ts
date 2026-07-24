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
