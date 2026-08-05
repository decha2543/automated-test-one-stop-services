import { describe, expect, it } from 'vitest';
import { applyEnter, nextMarkerFor } from '~/utils/list-continuation.js';

describe('nextMarkerFor', () => {
  it('increments an ordered marker, keeping its punctuation and indent', () => {
    expect(nextMarkerFor('1. เลือกปีเกิด')?.next).toBe('2. ');
    expect(nextMarkerFor('9) step')?.next).toBe('10) ');
    expect(nextMarkerFor('  3. indented')?.next).toBe('  4. ');
  });

  it('repeats an unordered marker', () => {
    expect(nextMarkerFor('• first')?.next).toBe('• ');
    expect(nextMarkerFor('- first')?.next).toBe('- ');
  });

  it('returns null for a plain line', () => {
    expect(nextMarkerFor('just text')).toBeNull();
    expect(nextMarkerFor('')).toBeNull();
  });
});

describe('applyEnter', () => {
  it('continues a numbered list at the caret', () => {
    const { value, caret } = applyEnter('1. one', 6);
    expect(value).toBe('1. one\n2. ');
    expect(caret).toBe(10);
  });

  it('continues a bullet list', () => {
    expect(applyEnter('• one', 5).value).toBe('• one\n• ');
  });

  it('inserts a plain newline outside a list', () => {
    expect(applyEnter('text', 4).value).toBe('text\n');
  });

  it('ends the list when Enter is pressed on an empty item', () => {
    const { value, caret } = applyEnter('1. one\n2. ', 10);
    expect(value).toBe('1. one\n\n');
    expect(caret).toBe(8);
  });

  it('keeps the text that follows the caret', () => {
    expect(applyEnter('1. onetwo', 6).value).toBe('1. one\n2. two');
  });
});
