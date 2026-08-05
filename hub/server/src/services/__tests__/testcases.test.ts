import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addTestCaseRow,
  applyRunStatus,
  editedPathFor,
  editTestCaseCell,
  listTestCaseDocs,
  parseCsvText,
  readOverlay,
  readTestCaseGrid,
  renameEditedBy,
  stampNow,
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
      // Updated At stamped as local YYYY-MM-DD HH:mm — a cell people read.
      expect(row?.[2]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
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

describe('applyRunStatus (run results → each case row)', () => {
  const HEADER =
    'Test Case ID,Actual Result,Status,Edited By,Updated At\nTC-A-001,,,,\nTC-A-002,old failure,,,\nTC-A-003,,,,\n';

  it('maps status + failure text onto matching rows only, and creates the overlay', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tc-sync-'));
    const csv = path.join(dir, 'demo-test-cases.csv');
    writeFileSync(csv, HEADER, 'utf8');
    try {
      expect(existsSync(editedPathFor(csv))).toBe(false);
      const res = await applyRunStatus(
        csv,
        {
          'TC-A-001': { status: 'passed' },
          'TC-A-002': { status: 'failed', error: 'expected 200, got 500' },
        },
        undefined,
        { id: 'u1', name: 'QA Somchai' },
      );
      expect(res?.matched).toBe(2);
      expect(res?.total).toBe(3);
      // The overlay is what carries results — the source csv stays byte-identical.
      expect(existsSync(editedPathFor(csv))).toBe(true);
      expect(readFileSync(csv, 'utf8')).toBe(HEADER);

      const rows = res?.grid.sheets[0]?.rows ?? [];
      expect(rows[1]?.[2]).toBe('Pass');
      expect(rows[1]?.[1]).toBe(''); // a pass clears any stale failure text
      expect(rows[2]?.[2]).toBe('Fail');
      expect(rows[2]?.[1]).toBe('expected 200, got 500');
      expect(rows[1]?.[4]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
      // The machine-readable instant stays ISO, in metadata rather than a cell.
      expect(readOverlay(csv)?.lastRunAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      // A reader needs a person beside a Pass/Fail, so the sync signs the row and
      // records it by user id for a later rename.
      expect(rows[1]?.[3]).toBe('QA Somchai');
      expect(readOverlay(csv)?.editors).toEqual({ '0:1': 'u1', '0:2': 'u1' });
      // An id the run never reported is left exactly as it was.
      expect(rows[3]?.[2]).toBe('');
      expect(rows[3]?.[3]).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes no overlay when the run matched no case id', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tc-nomatch-'));
    const csv = path.join(dir, 'demo-test-cases.csv');
    writeFileSync(csv, HEADER, 'utf8');
    try {
      const res = await applyRunStatus(csv, { 'TC-OTHER-999': { status: 'passed' } });
      expect(res?.matched).toBe(0);
      expect(existsSync(editedPathFor(csv))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Edited By attribution + rename', () => {
  it('stamps the author name and rewrites it by user id on rename', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tc-author-'));
    const csv = path.join(dir, 'demo-test-cases.csv');
    writeFileSync(
      csv,
      'Test Case ID,Status,Edited By,Updated At\nTC-A-001,,,\nTC-A-002,,,\n',
      'utf8',
    );
    try {
      await editTestCaseCell(csv, 0, 1, 1, 'Pass', { id: 'u1', name: 'Old Name' });
      // A row edited by someone else must not be swept up by the rename.
      await editTestCaseCell(csv, 0, 2, 1, 'Fail', { id: 'u2', name: 'Other' });
      const overlay = readOverlay(csv);
      expect(overlay?.sheets[0]?.rows[1]?.[2]).toBe('Old Name');
      expect(overlay?.editors).toEqual({ '0:1': 'u1', '0:2': 'u2' });

      const renamed = renameEditedBy([csv], 'u1', 'New Name');
      expect(renamed).toEqual({ rowsRenamed: 1, docsTouched: 1 });
      const after = readOverlay(csv);
      expect(after?.sheets[0]?.rows[1]?.[2]).toBe('New Name');
      expect(after?.sheets[0]?.rows[2]?.[2]).toBe('Other');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('listTestCaseDocs', () => {
  it('reports overlay presence and never lists a generated .result.xlsx', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tc-list-'));
    try {
      const csv = path.join(dir, 'demo-test-cases.csv');
      writeFileSync(csv, 'Test Case ID\nTC-A-001\n', 'utf8');
      writeFileSync(path.join(dir, 'demo-test-cases.result.xlsx'), 'not a real workbook', 'utf8');
      expect(listTestCaseDocs(dir).map((d) => d.name)).toEqual(['demo-test-cases.csv']);
      expect(listTestCaseDocs(dir)[0]?.edited).toBe(false);

      writeFileSync(editedPathFor(csv), JSON.stringify({ sheets: [] }), 'utf8');
      expect(listTestCaseDocs(dir)[0]?.edited).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('stampNow', () => {
  it('renders local YYYY-MM-DD HH:mm, zero-padded', () => {
    // Local components, so build the expectation from the same Date rather than
    // hardcoding a timezone-dependent string.
    const at = new Date(2026, 7, 5, 9, 21, 17);
    expect(stampNow(at)).toBe('2026-08-05 09:21');
  });
});
