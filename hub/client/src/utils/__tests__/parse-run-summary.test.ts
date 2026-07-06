import { describe, expect, it } from 'vitest';
import { parseRunSummary } from '../parse-run-summary.js';

describe('parseRunSummary', () => {
  it('returns null when there is no recognizable summary', () => {
    expect(parseRunSummary('booting up...\nno results here')).toBeNull();
  });

  it('parses Playwright pass/fail/skip counts', () => {
    expect(parseRunSummary('  3 passed (12.5s)')).toEqual({ passed: 3, failed: 0 });
    expect(parseRunSummary('2 failed\n5 passed\n1 skipped')).toEqual({
      passed: 5,
      failed: 2,
      skipped: 1,
    });
  });

  it('parses Robot Framework summary line', () => {
    expect(parseRunSummary('10 tests, 8 passed, 2 failed')).toEqual({ passed: 8, failed: 2 });
    expect(parseRunSummary('1 test, 1 passed, 0 failed')).toEqual({ passed: 1, failed: 0 });
  });

  it('maps k6 checks_succeeded to a single pass/fail', () => {
    // NOTE: the current regex matches dot-leaders + whitespace before the
    // percentage, but not a ':' separator. Real k6 output uses a ':' after the
    // leaders (e.g. "checks_succeeded...: 100%"), which this parser does NOT
    // match today — see the colon caveat below. These cases pin the behavior
    // that IS relied on.
    expect(parseRunSummary('checks_succeeded 100.00%')).toEqual({ passed: 1, failed: 0 });
    expect(parseRunSummary('checks_succeeded....... 87.50%')).toEqual({ passed: 0, failed: 1 });
  });

  it('does not match a colon-separated k6 leader (documents current limitation)', () => {
    expect(parseRunSummary('checks_succeeded...: 100.00%')).toBeNull();
  });

  it('strips ANSI colour codes before matching', () => {
    expect(parseRunSummary('\x1b[32m4 passed\x1b[0m (3.1s)')).toEqual({ passed: 4, failed: 0 });
  });
});
