import type { TestSummary } from '@hub/shared';
import { describe, expect, it } from 'vitest';
import {
  buildTagExpr,
  buildTagQuery,
  matchTests,
  parseTagQuery,
  parseTagSelection,
} from '~/utils/tag-selection.js';

const tests: TestSummary[] = [
  { id: '1', title: 'a', tags: ['@critical', '@desktop', '@LOGIN-C001'] },
  { id: '2', title: 'b', tags: ['@critical', '@desktop', '@LOGIN-C002', '@flaky'] },
  { id: '3', title: 'c', tags: ['@low', '@mobile', '@CART-C001'] },
];

describe('buildTagExpr with exclusions', () => {
  it('appends one negative group after the positive ones', () => {
    expect(buildTagExpr(['@critical'], ['@flaky'])).toBe('(?=.*@critical)(?!.*@flaky)');
    expect(buildTagExpr(['@critical'], ['@flaky', '@wip'])).toBe(
      '(?=.*@critical)(?!.*(?:@flaky|@wip))',
    );
  });

  it('emits an exclude-only expression when nothing is included', () => {
    expect(buildTagExpr([], ['@flaky'])).toBe('(?!.*@flaky)');
  });

  it('stays undefined when neither side has a tag', () => {
    expect(buildTagExpr([], [])).toBeUndefined();
  });

  it('drops blanks and duplicates from the exclude side', () => {
    expect(buildTagExpr([], ['@flaky', '@flaky', '  '])).toBe('(?!.*@flaky)');
  });
});

describe('round-trip: parseTagSelection(buildTagExpr(x)) === x', () => {
  const cases: Array<{ name: string; include: string[]; exclude: string[] }> = [
    { name: 'include only, one level', include: ['@critical'], exclude: [] },
    { name: 'include only, two levels', include: ['@critical', '@desktop'], exclude: [] },
    { name: 'include or-group', include: ['@LOGIN-C001', '@LOGIN-C002'], exclude: [] },
    { name: 'exclude only', include: [], exclude: ['@flaky'] },
    { name: 'exclude or-group', include: [], exclude: ['@flaky', '@wip'] },
    { name: 'mixed', include: ['@critical', '@desktop'], exclude: ['@flaky'] },
    {
      name: 'mixed with both or-groups',
      include: ['@LOGIN-C001', '@LOGIN-C002'],
      exclude: ['@flaky', '@wip'],
    },
  ];

  for (const { name, include, exclude } of cases) {
    it(name, () => {
      const expr = buildTagExpr(include, exclude);
      const parsed = parseTagSelection(expr);
      expect(parsed.include.sort()).toEqual([...include].sort());
      expect(parsed.exclude.sort()).toEqual([...exclude].sort());
    });
  }
});

describe('parseTagSelection', () => {
  it('keeps a hand-typed bare value as an include', () => {
    expect(parseTagSelection('@smoke')).toEqual({ include: ['@smoke'], exclude: [] });
  });

  it('returns empty for no expression', () => {
    expect(parseTagSelection(undefined)).toEqual({ include: [], exclude: [] });
  });
});

describe('matchTests with exclusions', () => {
  it('drops a test carrying an excluded tag even when it matches the includes', () => {
    const got = matchTests(tests, ['@critical', '@desktop'], ['@flaky']);
    expect(got.map((t) => t.id)).toEqual(['1']);
  });

  it('exclusion alone filters without narrowing by include', () => {
    expect(matchTests(tests, [], ['@flaky']).map((t) => t.id)).toEqual(['1', '3']);
  });

  it('ignores the level of an excluded tag', () => {
    // @desktop is a device-level tag; excluding it must remove both device tests
    // rather than being satisfied by another device tag.
    expect(matchTests(tests, [], ['@desktop']).map((t) => t.id)).toEqual(['3']);
  });
});

describe('buildTagQuery / parseTagQuery — Robot Framework syntax', () => {
  const robot = 'robot-framework';

  it('emits a tag PATTERN, not a regex (the pre-existing Robot bug)', () => {
    // @critical is severity-level, @desktop device-level -> AND across levels.
    expect(buildTagQuery(robot, ['@critical', '@desktop'])).toBe('@criticalAND@desktop');
    // Two case ids share one level -> OR within the level.
    expect(buildTagQuery(robot, ['@TC-A-001', '@TC-A-002'])).toBe('@TC-A-001OR@TC-A-002');
    expect(buildTagQuery(robot, ['@critical'])).not.toContain('(?=');
  });

  it('subtracts exclusions with NOT, matching everything first when nothing is included', () => {
    expect(buildTagQuery(robot, ['@critical'], ['@flaky'])).toBe('@criticalNOT@flaky');
    expect(buildTagQuery(robot, [], ['@flaky'])).toBe('*NOT@flaky');
    expect(buildTagQuery(robot, [], ['@flaky', '@wip'])).toBe('*NOT@flakyNOT@wip');
  });

  it('is undefined when nothing is selected either way', () => {
    expect(buildTagQuery(robot, [], [])).toBeUndefined();
  });

  it('keeps the Playwright form for every other tool', () => {
    expect(buildTagQuery('playwright', ['@critical'], ['@flaky'])).toBe(
      '(?=.*@critical)(?!.*@flaky)',
    );
  });

  it('round-trips through parseTagQuery', () => {
    for (const [include, exclude] of [
      [['@critical', '@desktop'], []],
      [['@TC-A-001', '@TC-A-002'], []],
      [['@critical'], ['@flaky']],
      [[], ['@flaky', '@wip']],
    ] as Array<[string[], string[]]>) {
      const parsed = parseTagQuery(robot, buildTagQuery(robot, include, exclude));
      expect(parsed.include.sort()).toEqual([...include].sort());
      expect(parsed.exclude.sort()).toEqual([...exclude].sort());
    }
  });
});
