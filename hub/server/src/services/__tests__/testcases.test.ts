import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    addTestCaseRow,
    editedPathFor,
    editTestCaseCell,
    parseCsvText,
    readTestCaseGrid,
} from '../testcases.js';

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

describe('test-case grid editing (.edited.json overlay)', () => {
  it('edits a cell, stamps Updated At, prefers the overlay, and adds rows', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tc-edit-'));
    const csv = path.join(dir, 'demo-test-cases.csv');
    writeFileSync(csv, 'Test Case ID,Status,Updated At\nTC-A-001,,\nTC-A-002,,\n', 'utf8');
    try {
      const before = await readTestCaseGrid(csv);
      expect(before?.edited).toBe(false);
      expect(before?.sheets[0]?.rows[1]?.[0]).toBe('TC-A-001');

      // edit Status (col 1) of the first data row (row 1)
      const grid = await editTestCaseCell(csv, 0, 1, 1, 'Pass');
      const row = grid?.sheets[0]?.rows[1];
      expect(grid?.edited).toBe(true);
      expect(row?.[1]).toBe('Pass');
      expect(row?.[2]).toMatch(/^\d{4}-\d{2}-\d{2}T/); // Updated At stamped
      expect(existsSync(editedPathFor(csv))).toBe(true);

      // re-read now prefers the overlay
      const after = await readTestCaseGrid(csv);
      expect(after?.edited).toBe(true);
      expect(after?.sheets[0]?.rows[1]?.[1]).toBe('Pass');

      // the header row is never editable
      expect(await editTestCaseCell(csv, 0, 0, 1, 'x')).toBeNull();

      // a locked identity column (Test Case ID) with an existing value cannot change
      expect(await editTestCaseCell(csv, 0, 1, 0, 'TC-CHANGED')).toBeNull();

      // add a blank row -> header + 2 data + 1 new
      const added = await addTestCaseRow(csv, 0);
      expect(added?.sheets[0]?.rows.length).toBe(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
