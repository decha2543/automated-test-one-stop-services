/**
 * Test-case summary parsed from raw runner output, shared by client and server.
 *
 * Lives in `@hub/shared` (not the client) because BOTH sides need it: the client
 * shows a live summary during a run, and the server parses the same summary at
 * `run-finished` to persist it into history (so the Reports table can show how
 * many cases each report covered). One implementation, two consumers.
 *
 * Supports Playwright, Robot Framework, and k6 reporter formats and strips ANSI
 * colour codes before matching. Returns `null` when no known summary line is
 * present, so callers can tell "no result yet" apart from "0 passed / 0 failed".
 */
export interface RunSummary {
  passed: number;
  failed: number;
  skipped?: number;
}

export function parseRunSummary(raw: string): RunSummary | null {
  // Strip ANSI colour codes so the numeric matches aren't broken by escapes.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping
  const text = raw.replace(/\x1b\[[0-9;]*m/g, '');

  let passed = 0;
  let failed = 0;
  let skipped: number | undefined;
  let matched = false;

  // Playwright: "  3 passed (12.5s)" / "2 failed" / "1 skipped"
  const pwPassed = text.match(/(\d+) passed\b/);
  if (pwPassed) {
    passed = Number.parseInt(pwPassed[1] ?? '0', 10);
    matched = true;
  }
  const pwFailed = text.match(/(\d+) failed\b/);
  if (pwFailed) {
    failed = Number.parseInt(pwFailed[1] ?? '0', 10);
    matched = true;
  }
  const pwSkipped = text.match(/(\d+) skipped\b/);
  if (pwSkipped) {
    skipped = Number.parseInt(pwSkipped[1] ?? '0', 10);
    matched = true;
  }

  // Robot Framework: "X tests, Y passed, Z failed"
  const robotLine = text.match(/(\d+) tests?, (\d+) passed, (\d+) failed/);
  if (robotLine) {
    passed = Number.parseInt(robotLine[2] ?? '0', 10);
    failed = Number.parseInt(robotLine[3] ?? '0', 10);
    matched = true;
  }

  // k6 checks summary
  const k6Checks = text.match(/checks_succeeded\s*[.…]*\s*([\d.]+)%/);
  if (k6Checks) {
    matched = true;
    const pct = Number.parseFloat(k6Checks[1] ?? '0');
    if (pct === 100) passed = 1;
    else failed = 1;
  }

  if (!matched) return null;
  return skipped !== undefined ? { passed, failed, skipped } : { passed, failed };
}
