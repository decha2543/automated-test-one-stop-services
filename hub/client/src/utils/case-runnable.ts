/** State of the project's spec-tag scan, as far as the grid is concerned. */
export interface CoverageScan {
  /** Case ids some spec declares as a tag, `@` already stripped. */
  coveredIds: ReadonlySet<string>;
  /** The scan returned (an empty result is still an answer). */
  settled: boolean;
  /** The scan failed, so coverage is genuinely unknown. */
  failed: boolean;
}

/**
 * Whether a doc case can be handed to the Run page.
 *
 * Coverage is only an answer once the scan has RETURNED. While it is in flight
 * the caller must not render a runnable link at all — treating "not yet loaded"
 * as "covered" is what let a case be clicked to run a spec that does not exist.
 * A FAILED scan stays permissive on purpose: offering a run that may not resolve
 * beats hiding every case behind a false "no spec" label.
 */
export function isCaseRunnable(scan: CoverageScan, caseId: string): boolean {
  const id = caseId.trim();
  if (id === '') return false;
  if (!scan.settled || scan.failed) return true;
  return scan.coveredIds.has(id);
}

/**
 * True once the scan can be trusted to say a case is NOT covered. Callers use it
 * to pick between the "no spec yet" message and the plain "nothing selected" one.
 */
export function isCoverageKnown(scan: CoverageScan): boolean {
  return scan.settled && !scan.failed;
}
