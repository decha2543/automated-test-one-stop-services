import fs from 'node:fs';
import path from 'node:path';
import type {
  TestCaseCsv,
  TestCaseDoc,
  TestCaseGrid,
  TestCaseSheet,
  TestCaseWorkbook,
} from '@hub/shared';
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

const EDITED_SUFFIX = '.edited.json';
const UPDATED_AT_HEADER = 'Updated At';
// Identity columns: fillable while empty (a new row) but never changed once set.
const LOCKED_HEADERS = new Set(['Test Case ID', 'Module', 'Requirement Ref ID']);

/** Path of the local edit overlay that sits beside a source doc. */
export function editedPathFor(docPath: string): string {
  return `${docPath}${EDITED_SUFFIX}`;
}

function writeOverlay(docPath: string, sheets: TestCaseSheet[]): void {
  const payload = { source: path.basename(docPath), savedAt: new Date().toISOString(), sheets };
  fs.writeFileSync(editedPathFor(docPath), JSON.stringify(payload, null, 2), 'utf8');
}

/**
 * Read a doc as an editable grid, preferring the `.edited.json` overlay when one
 * exists — so Hub edits never touch the pipeline's source doc. Each sheet's
 * rows[0] is the header row. Best-effort: returns null when nothing is readable.
 */
export async function readTestCaseGrid(docPath: string): Promise<TestCaseGrid | null> {
  const overlayPath = editedPathFor(docPath);
  if (fs.existsSync(overlayPath)) {
    try {
      const overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8')) as {
        sheets?: TestCaseSheet[];
      };
      if (Array.isArray(overlay.sheets)) return { sheets: overlay.sheets, edited: true };
    } catch {
      // Corrupt overlay — fall back to the source doc.
    }
  }
  const lower = docPath.toLowerCase();
  if (lower.endsWith('.csv')) {
    const csv = readTestCaseCsv(docPath);
    return csv
      ? { sheets: [{ name: 'Sheet1', rows: [csv.headers, ...csv.rows] }], edited: false }
      : null;
  }
  if (lower.endsWith('.xlsx')) {
    const wb = await readTestCaseXlsx(docPath);
    return wb ? { sheets: wb.sheets, edited: false } : null;
  }
  return null;
}

/** Column index of the "Updated At" header in a header row, or -1. */
function updatedAtIndex(header: string[]): number {
  return header.findIndex((h) => h.trim().toLowerCase() === UPDATED_AT_HEADER.toLowerCase());
}

/**
 * Edit one cell and stamp that row's "Updated At" (when the sheet has such a
 * column), persisting to the `.edited.json` overlay. Row 0 is the header and is
 * never editable. Returns the updated grid, or null when the target is invalid.
 */
export async function editTestCaseCell(
  docPath: string,
  sheetIdx: number,
  rowIdx: number,
  colIdx: number,
  value: string,
): Promise<TestCaseGrid | null> {
  if (rowIdx < 1 || colIdx < 0) return null;
  const grid = await readTestCaseGrid(docPath);
  const sheet = grid?.sheets[sheetIdx];
  if (!grid || !sheet) return null;
  const header = sheet.rows[0] ?? [];
  const row = sheet.rows[rowIdx];
  if (!row || colIdx >= header.length) return null;
  // A locked identity column can be filled while empty (new row) but never changed.
  if (LOCKED_HEADERS.has((header[colIdx] ?? '').trim()) && (row[colIdx] ?? '').trim() !== '') {
    return null;
  }
  while (row.length < header.length) row.push('');
  row[colIdx] = value;
  const uaIdx = updatedAtIndex(header);
  if (uaIdx >= 0) {
    while (row.length <= uaIdx) row.push('');
    row[uaIdx] = new Date().toISOString();
  }
  writeOverlay(docPath, grid.sheets);
  return { sheets: grid.sheets, edited: true };
}

/** Append a blank row to a sheet, persisting to the overlay. */
export async function addTestCaseRow(
  docPath: string,
  sheetIdx: number,
): Promise<TestCaseGrid | null> {
  const grid = await readTestCaseGrid(docPath);
  const sheet = grid?.sheets[sheetIdx];
  if (!grid || !sheet) return null;
  const width = sheet.rows[0]?.length ?? 0;
  sheet.rows.push(new Array<string>(width).fill(''));
  writeOverlay(docPath, grid.sheets);
  return { sheets: grid.sheets, edited: true };
}

const ID_HEADER = 'Test Case ID';
const STATUS_HEADER = 'Status';

function headerIndex(header: string[], name: string): number {
  return header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
}

/**
 * Fill each doc row's Status (Pass/Fail) + Updated At from a run's per-case
 * results, matched by Test Case ID, persisting to the `.edited.json` overlay
 * (never the source doc). Rows without a matching run result are left untouched.
 * Returns the updated grid + how many rows matched, or null when unreadable.
 */
export async function applyRunStatus(
  docPath: string,
  statusByCaseId: Record<string, 'passed' | 'failed'>,
): Promise<{ grid: TestCaseGrid; matched: number; total: number } | null> {
  const grid = await readTestCaseGrid(docPath);
  if (!grid) return null;
  const now = new Date().toISOString();
  let matched = 0;
  let total = 0;
  for (const sheet of grid.sheets) {
    const header = sheet.rows[0] ?? [];
    const idIdx = headerIndex(header, ID_HEADER);
    const statusIdx = headerIndex(header, STATUS_HEADER);
    if (idIdx < 0 || statusIdx < 0) continue;
    const uaIdx = updatedAtIndex(header);
    for (let r = 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r];
      if (!row) continue;
      total++;
      const id = (row[idIdx] ?? '').trim();
      const outcome = id ? statusByCaseId[id] : undefined;
      if (!outcome) continue;
      const widest = Math.max(statusIdx, uaIdx);
      while (row.length <= widest) row.push('');
      row[statusIdx] = outcome === 'passed' ? 'Pass' : 'Fail';
      if (uaIdx >= 0) row[uaIdx] = now;
      matched++;
    }
  }
  if (matched > 0) writeOverlay(docPath, grid.sheets);
  return { grid: { sheets: grid.sheets, edited: matched > 0 || grid.edited }, matched, total };
}
