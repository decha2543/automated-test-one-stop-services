import fs from 'node:fs';
import path from 'node:path';
import type { TestCaseCsv, TestCaseDoc, TestCaseSheet, TestCaseWorkbook } from '@hub/shared';
import ExcelJS from 'exceljs';

// A test-case document is an xlsx/csv whose name reads like "test-case(s)"
// (e.g. `ta_test-case.xlsx`, `sp-non-life-test-cases.csv`).
const TEST_CASE_RE = /test[-_ ]?cases?/i;
const SKIP_DIRS = new Set(['node_modules', '.git']);
const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_CSV_ROWS = 1000;

/**
 * Recursively list test-case docs under a project directory. Best-effort:
 * unreadable subdirectories are skipped rather than throwing. The caller is
 * responsible for validating `projectDir` is inside `tools/` (path-guard).
 */
export function listTestCaseDocs(projectDir: string): TestCaseDoc[] {
  if (!fs.existsSync(projectDir)) return [];
  const docs: TestCaseDoc[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      const lower = entry.name.toLowerCase();
      const ext = lower.endsWith('.xlsx') ? 'xlsx' : lower.endsWith('.csv') ? 'csv' : null;
      if (!ext || !TEST_CASE_RE.test(entry.name)) continue;
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        // ignore stat failure; report size 0
      }
      docs.push({
        name: entry.name,
        relPath: path.relative(projectDir, full).replace(/\\/g, '/'),
        path: full,
        ext,
        size,
      });
    }
  };
  walk(projectDir);
  return docs.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/**
 * Parse CSV text into rows. Handles quoted fields, escaped quotes (`""`), and
 * newlines inside quotes. A single trailing newline does not produce an empty
 * final row.
 */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Read + parse a CSV test-case doc into headers + capped data rows. Best-effort:
 * a missing / oversized / unreadable file yields `null`.
 */
export function readTestCaseCsv(absPath: string): TestCaseCsv | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return null;
  }
  if (stat.size > MAX_CSV_BYTES) return null;
  let parsed: string[][];
  try {
    parsed = parseCsvText(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
  const headers = parsed[0] ?? [];
  const dataRows = parsed.slice(1);
  const truncated = dataRows.length > MAX_CSV_ROWS;
  return { headers, rows: truncated ? dataRows.slice(0, MAX_CSV_ROWS) : dataRows, truncated };
}

const MAX_XLSX_BYTES = 10 * 1024 * 1024;
const MAX_XLSX_ROWS = 1000;

/**
 * Read + parse an xlsx test-case doc into worksheets of rows (via exceljs).
 * Each cell uses its formatted display text. Best-effort: a missing / oversized
 * / unreadable file yields `null`; each worksheet is capped to MAX_XLSX_ROWS.
 */
export async function readTestCaseXlsx(absPath: string): Promise<TestCaseWorkbook | null> {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return null;
  }
  if (stat.size > MAX_XLSX_BYTES) return null;
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(absPath);
    const sheets: TestCaseSheet[] = [];
    let truncated = false;
    workbook.eachSheet((worksheet) => {
      const colCount = worksheet.actualColumnCount || worksheet.columnCount || 0;
      const rowCount = worksheet.actualRowCount || worksheet.rowCount || 0;
      if (rowCount > MAX_XLSX_ROWS) truncated = true;
      const cap = Math.min(rowCount, MAX_XLSX_ROWS);
      const rows: string[][] = [];
      for (let r = 1; r <= cap; r++) {
        const row = worksheet.getRow(r);
        const cells: string[] = [];
        for (let c = 1; c <= colCount; c++) cells.push(row.getCell(c).text);
        rows.push(cells);
      }
      sheets.push({ name: worksheet.name, rows });
    });
    return { sheets, truncated };
  } catch {
    return null;
  }
}
