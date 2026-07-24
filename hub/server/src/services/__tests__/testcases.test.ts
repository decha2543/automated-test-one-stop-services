import { describe, expect, it } from 'vitest';
import { parseCsvText } from '../testcases.js';

describe('parseCsvText', () => {
  it('parses simple rows', () => {
    expect(parseCsvText('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('honors quoted fields with commas and escaped quotes', () => {
    expect(parseCsvText('"a,b","c""d"')).toEqual([['a,b', 'c"d']]);
  });

  it('supports newlines inside quoted fields', () => {
    expect(parseCsvText('"line1\nline2",x')).toEqual([['line1\nline2', 'x']]);
  });

  it('ignores a single trailing newline (no empty final row)', () => {
    expect(parseCsvText('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsvText('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});
