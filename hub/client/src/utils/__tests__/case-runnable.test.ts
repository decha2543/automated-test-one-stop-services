import { describe, expect, it } from 'vitest';
import { type CoverageScan, isCaseRunnable, isCoverageKnown } from '~/utils/case-runnable.js';

const scan = (over: Partial<CoverageScan> = {}): CoverageScan => ({
  coveredIds: new Set(['TC-MOTOR-001']),
  settled: true,
  failed: false,
  ...over,
});

describe('isCaseRunnable', () => {
  it('honours the scan once it has settled', () => {
    expect(isCaseRunnable(scan(), 'TC-MOTOR-001')).toBe(true);
    expect(isCaseRunnable(scan(), 'TC-MOTOR-002')).toBe(false);
  });

  it('trims the id before matching', () => {
    expect(isCaseRunnable(scan(), '  TC-MOTOR-001 ')).toBe(true);
  });

  it('treats a settled empty scan as "nothing is covered"', () => {
    // The regression: an in-flight scan looked identical to an empty one, so every
    // case rendered as runnable before coverage was known.
    expect(isCaseRunnable(scan({ coveredIds: new Set() }), 'TC-MOTOR-001')).toBe(false);
  });

  it('stays permissive while unsettled or after a failure', () => {
    expect(isCaseRunnable(scan({ settled: false, coveredIds: new Set() }), 'TC-MOTOR-002')).toBe(
      true,
    );
    expect(isCaseRunnable(scan({ failed: true }), 'TC-MOTOR-002')).toBe(true);
  });

  it('never calls a blank id runnable', () => {
    expect(isCaseRunnable(scan({ settled: false }), '   ')).toBe(false);
  });
});

describe('isCoverageKnown', () => {
  it('is true only for a settled, successful scan', () => {
    expect(isCoverageKnown(scan())).toBe(true);
    expect(isCoverageKnown(scan({ coveredIds: new Set() }))).toBe(true);
    expect(isCoverageKnown(scan({ settled: false }))).toBe(false);
    expect(isCoverageKnown(scan({ failed: true }))).toBe(false);
  });
});
