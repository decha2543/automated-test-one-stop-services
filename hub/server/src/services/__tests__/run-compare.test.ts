import { describe, expect, it } from 'vitest';
import { diffOutcomes, type RunOutcome } from '../run-compare.js';

const o = (key: string, status: 'passed' | 'failed', title = key): RunOutcome => ({
  key,
  title,
  status,
});

describe('diffOutcomes', () => {
  it('classifies every transition and tallies counts', () => {
    const a = [
      o('t1', 'passed'),
      o('t2', 'failed'),
      o('t3', 'failed'),
      o('t4', 'passed'),
      o('gone', 'failed'),
    ];
    const b = [
      o('t1', 'failed'),
      o('t2', 'passed'),
      o('t3', 'failed'),
      o('t4', 'passed'),
      o('new', 'passed'),
    ];
    const { rows, counts } = diffOutcomes(a, b);
    expect(counts).toEqual({
      newlyFailed: 1,
      fixed: 1,
      stillFailing: 1,
      stillPassing: 1,
      added: 1,
      removed: 1,
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.category]));
    expect(byKey.t1).toBe('newlyFailed');
    expect(byKey.t2).toBe('fixed');
    expect(byKey.t3).toBe('stillFailing');
    expect(byKey.t4).toBe('stillPassing');
    expect(byKey.new).toBe('added');
    expect(byKey.gone).toBe('removed');
  });

  it('orders the most actionable categories first', () => {
    const a = [o('p', 'passed'), o('r', 'passed')];
    const b = [o('p', 'passed'), o('r', 'failed')];
    const { rows } = diffOutcomes(a, b);
    expect(rows[0]?.category).toBe('newlyFailed');
    expect(rows[rows.length - 1]?.category).toBe('stillPassing');
  });

  it('handles empty inputs (all added / all removed / nothing)', () => {
    expect(diffOutcomes([], []).rows).toHaveLength(0);
    expect(diffOutcomes([o('x', 'passed')], []).counts.removed).toBe(1);
    expect(diffOutcomes([], [o('x', 'failed')]).counts.added).toBe(1);
  });
});
