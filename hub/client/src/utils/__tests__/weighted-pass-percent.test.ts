import { emptySeverityBreakdown, weightedPassPercent } from '@hub/shared';
import { describe, expect, it } from 'vitest';

describe('weightedPassPercent', () => {
  it('returns null when there are no weighted cases', () => {
    expect(weightedPassPercent(emptySeverityBreakdown())).toBeNull();
  });

  it('returns 100 when every case passed', () => {
    const b = emptySeverityBreakdown();
    b.critical.passed = 2;
    b.low.passed = 3;
    expect(weightedPassPercent(b)).toBe(100);
  });

  it('returns 0 when every case failed', () => {
    const b = emptySeverityBreakdown();
    b.high.failed = 4;
    expect(weightedPassPercent(b)).toBe(0);
  });

  it('weights a failing critical heavier than a failing low', () => {
    // One critical (weight 4) fails, one low (weight 1) passes.
    // scored = 1·1 = 1 ; total = 4·1 + 1·1 = 5 → 20%
    const failCritical = emptySeverityBreakdown();
    failCritical.critical.failed = 1;
    failCritical.low.passed = 1;
    expect(weightedPassPercent(failCritical)).toBeCloseTo(20);

    // Inverse: critical passes, low fails → scored = 4 ; total = 5 → 80%
    const failLow = emptySeverityBreakdown();
    failLow.critical.passed = 1;
    failLow.low.failed = 1;
    expect(weightedPassPercent(failLow)).toBeCloseTo(80);

    // A failing critical must hurt the score more than a failing low.
    expect(weightedPassPercent(failCritical)).toBeLessThan(
      weightedPassPercent(failLow) as number,
    );
  });

  it('applies the 4/3/2/1 weights across all levels', () => {
    // All four levels: one pass + one fail each.
    // scored = 4+3+2+1 = 10 ; total = 2·(4+3+2+1) = 20 → 50%
    const b = emptySeverityBreakdown();
    for (const level of ['critical', 'high', 'medium', 'low'] as const) {
      b[level].passed = 1;
      b[level].failed = 1;
    }
    expect(weightedPassPercent(b)).toBe(50);
  });
});
