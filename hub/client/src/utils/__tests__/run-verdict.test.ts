import { describe, expect, it } from 'vitest';
import { en } from '~/i18n/en';
import { runVerdict } from '~/utils/run-verdict.js';

/** Real English strings, so a renamed placeholder fails here instead of shipping. */
const t = (key: keyof typeof en) => en[key];

describe('runVerdict', () => {
  it('counts passed + failed + skipped as the total', () => {
    expect(runVerdict({ passed: 8, failed: 2, skipped: 1 }, t)).toBe('2 of 11 checks did not pass');
  });

  it('reports an all-passed run without mentioning failures', () => {
    expect(runVerdict({ passed: 6, failed: 0 }, t)).toBe('All 6 checks passed');
  });

  it('treats a missing or empty summary as "nothing ran"', () => {
    expect(runVerdict(null, t)).toBe('Finished without running any check');
    expect(runVerdict({ passed: 0, failed: 0, skipped: 0 }, t)).toBe(
      'Finished without running any check',
    );
  });

  it('leaves no unsubstituted placeholder in any branch', () => {
    const outputs = [
      runVerdict({ passed: 1, failed: 1 }, t),
      runVerdict({ passed: 1, failed: 0 }, t),
      runVerdict(null, t),
    ];
    for (const out of outputs) expect(out).not.toMatch(/\{\w+\}/);
  });
});
