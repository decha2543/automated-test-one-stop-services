import { describe, expect, it } from 'vitest';
import { buildTagExpr, getTagLevel, matchTests, parseTagExpr } from '../tag-selection.js';

// The four shapes real projects emit: `_LOOP-C<nnn>` per case (three prefixes)
// and the bare `_LOOP` multi-test tag.
const LOOP_TAGS = [
  '@TA_INTER_FAMILY_LOOP-C003',
  '@TA_INTER_GROUP_LOOP-C001',
  '@TA_INTER_LOOP-C007',
  '@TA_INTER_FAMILY_LOOP',
];

describe("getTagLevel — 'loop' level", () => {
  for (const tag of LOOP_TAGS) {
    it(`classifies ${tag} as loop`, () => {
      expect(getTagLevel(tag)).toBe('loop');
    });
  }

  it('leaves a plain case-id, a domain tag and a facet tag alone', () => {
    expect(getTagLevel('@TC-TADOM-001')).toBe('product');
    expect(getTagLevel('@LOOPBACK_AUTH')).toBe('product');
    expect(getTagLevel('@critical')).toBe('severity');
  });
});

describe('buildTagExpr with loop tags', () => {
  it('ORs two loop tags (same level — they are alternatives)', () => {
    expect(buildTagExpr(['@TA_INTER_LOOP-C001', '@TA_INTER_LOOP-C002'])).toBe(
      '(?=.*(?:@TA_INTER_LOOP-C001|@TA_INTER_LOOP-C002))',
    );
  });

  it('ANDs a loop tag with a severity tag (different levels)', () => {
    expect(buildTagExpr(['@TA_INTER_LOOP-C001', '@critical'])).toBe(
      '(?=.*@TA_INTER_LOOP-C001)(?=.*@critical)',
    );
  });

  it('round-trips a loop expression through parseTagExpr', () => {
    const selected = ['@TA_INTER_LOOP-C001', '@TA_INTER_LOOP-C002', '@critical'];
    expect([...parseTagExpr(buildTagExpr(selected))].sort()).toEqual([...selected].sort());
  });

  it('still UNIONS a loop tag with a non-loop case-id — the group is visual only', () => {
    const tests = [
      { id: 'TA_INTER_LOOP-C001', title: 'loop 1', tags: ['@TA_INTER_LOOP-C001'] },
      { id: 'TC-TADOM-001', title: 'domestic 1', tags: ['@TC-TADOM-001'] },
    ];
    expect(matchTests(tests, ['@TA_INTER_LOOP-C001', '@TC-TADOM-001'])).toHaveLength(2);
    expect(buildTagExpr(['@TA_INTER_LOOP-C001', '@TC-TADOM-001'])).toBe(
      '(?=.*(?:@TA_INTER_LOOP-C001|@TC-TADOM-001))',
    );
  });
});
