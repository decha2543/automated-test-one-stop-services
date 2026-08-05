import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  createTestCaseDoc,
  moduleDocPath,
  resultPathFor,
  TEST_CASE_HEADERS,
  writeResultXlsx,
} from '../testcase-xlsx.js';
import { applyRunStatus } from '../testcases.js';

/** Row values of a workbook's first worksheet, as display strings. */
async function readRows(file: string): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= TEST_CASE_HEADERS.length; c++) cells.push(row.getCell(c).text);
    rows.push(cells);
  }
  return rows;
}

describe('createTestCaseDoc', () => {
  it('writes the standard 18-column template and refuses a duplicate', async () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), 'tc-create-'));
    mkdirSync(path.join(projectDir, 'automations', 'specs', 'health'), { recursive: true });
    try {
      const created = await createTestCaseDoc(projectDir, 'health');
      expect(created).toEqual({ path: moduleDocPath(projectDir, 'health') });
      const rows = await readRows(moduleDocPath(projectDir, 'health'));
      expect(rows[0]).toEqual([...TEST_CASE_HEADERS]);
      // Header only — a scaffolded doc must not invent cases.
      expect(rows.length).toBe(1);

      // A module owns exactly one doc, so a second attempt is refused.
      expect(await createTestCaseDoc(projectDir, 'health')).toEqual({ error: 'DUPLICATE' });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

describe('writeResultXlsx', () => {
  it('exports overlay values to a sibling .result.xlsx, leaving the source alone', async () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), 'tc-result-'));
    mkdirSync(path.join(projectDir, 'automations', 'specs', 'ta'), { recursive: true });
    try {
      const created = await createTestCaseDoc(projectDir, 'ta');
      if ('error' in created) throw new Error('fixture failed to create the doc');
      const docPath = created.path;

      // Seed one case, then map a failing run onto it (both land in the overlay).
      const idCol = TEST_CASE_HEADERS.indexOf('Test Case ID');
      const statusCol = TEST_CASE_HEADERS.indexOf('Status');
      const actualCol = TEST_CASE_HEADERS.indexOf('Actual Result');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(docPath);
      const ws = wb.worksheets[0];
      if (!ws) throw new Error('fixture workbook has no worksheet');
      ws.getRow(2).getCell(idCol + 1).value = 'TC-TA-001';
      await wb.xlsx.writeFile(docPath);

      const applied = await applyRunStatus(docPath, {
        'TC-TA-001': { status: 'failed', error: 'timeout waiting for #submit' },
      });
      expect(applied?.matched).toBe(1);

      const out = await writeResultXlsx(docPath);
      expect(out).toBe(resultPathFor(docPath));
      expect(path.basename(out ?? '')).toBe('ta_test-case.result.xlsx');

      const rows = await readRows(out ?? '');
      expect(rows[0]).toEqual([...TEST_CASE_HEADERS]);
      expect(rows[1]?.[statusCol]).toBe('Fail');
      expect(rows[1]?.[actualCol]).toBe('timeout waiting for #submit');

      // The source workbook still has no result mapped into it.
      const source = await readRows(docPath);
      expect(source[1]?.[statusCol]).toBe('');
      expect(existsSync(docPath)).toBe(true);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
