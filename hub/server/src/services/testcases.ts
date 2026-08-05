import fs from 'node:fs';
import path from 'node:path';
import type {
  TestCaseCsv,
  TestCaseDoc,
  TestCaseGrid,
  TestCaseModule,
  TestCaseOverlay,
  TestCaseRunResult,
  TestCaseSheet,
  TestCaseWorkbook,
} from '@hub/shared';
import ExcelJS from 'exceljs';

// A test-case document is an xlsx/csv whose name reads like "test-case(s)"
// (e.g. `ta_test-case.xlsx`, `sp-non-life-test-cases.csv`).
const TEST_CASE_RE = /test[-_ ]?cases?/i;
/**
 * Generated result workbooks (`<doc>.result.xlsx`, git-ignored) also match
 * TEST_CASE_RE. They are derived artifacts, not source docs, so they must never
 * appear in the doc list — otherwise a result export would show up as another
 * editable test-case document.
 */
export const RESULT_SUFFIX = '.result.xlsx';
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
      if (lower.endsWith(RESULT_SUFFIX)) continue;
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
        edited: fs.existsSync(editedPathFor(full)),
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
const EDITED_BY_HEADER = 'Edited By';
const ACTUAL_RESULT_HEADER = 'Actual Result';
// Identity columns: fillable while empty (a new row) but never changed once set.
const LOCKED_HEADERS = new Set(['Test Case ID', 'Module', 'Requirement Ref ID']);

/** Path of the local edit overlay that sits beside a source doc. */
export function editedPathFor(docPath: string): string {
  return `${docPath}${EDITED_SUFFIX}`;
}

/**
 * "Updated At" as `YYYY-MM-DD HH:mm` in the machine's LOCAL time.
 *
 * This cell is read by people in a spreadsheet, so it is formatted for them, not
 * for a parser — an ISO-8601 UTC stamp forced the reader to mentally shift the
 * timezone. Year-first keeps a text sort chronological, and seconds are dropped
 * because nobody reads a test-case doc to that precision. Machine-readable
 * instants stay ISO in the overlay's own metadata (`savedAt`, `lastRunAt`).
 */
export function stampNow(at: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `${date} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** Key under which an overlay records which user last edited a row. */
function editorKey(sheetIdx: number, rowIdx: number): string {
  return `${sheetIdx}:${rowIdx}`;
}

/** Read the raw overlay beside a doc, or null when absent / unparseable. */
export function readOverlay(docPath: string): TestCaseOverlay | null {
  const overlayPath = editedPathFor(docPath);
  if (!fs.existsSync(overlayPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(overlayPath, 'utf8')) as Partial<TestCaseOverlay>;
    if (!Array.isArray(parsed.sheets)) return null;
    return {
      source: parsed.source ?? path.basename(docPath),
      savedAt: parsed.savedAt ?? new Date().toISOString(),
      sheets: parsed.sheets,
      ...(parsed.editors ? { editors: parsed.editors } : {}),
      ...(parsed.lastRunAt ? { lastRunAt: parsed.lastRunAt } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Persist the overlay beside the source doc. Metadata the caller does not touch
 * (`editors`, `lastRunAt`) is carried over from the existing overlay, so a cell
 * edit never drops the row→user mapping a rename depends on.
 */
function writeOverlay(
  docPath: string,
  sheets: TestCaseSheet[],
  extra?: Pick<Partial<TestCaseOverlay>, 'editors' | 'lastRunAt'>,
): void {
  const previous = readOverlay(docPath);
  const editors = extra?.editors ?? previous?.editors;
  const lastRunAt = extra?.lastRunAt ?? previous?.lastRunAt;
  const payload: TestCaseOverlay = {
    source: path.basename(docPath),
    savedAt: new Date().toISOString(),
    sheets,
    ...(editors && Object.keys(editors).length > 0 ? { editors } : {}),
    ...(lastRunAt ? { lastRunAt } : {}),
  };
  fs.writeFileSync(editedPathFor(docPath), JSON.stringify(payload, null, 2), 'utf8');
}

/**
 * Read a doc as an editable grid, preferring the `.edited.json` overlay when one
 * exists — so Hub edits never touch the pipeline's source doc. Each sheet's
 * rows[0] is the header row. Best-effort: returns null when nothing is readable.
 */
export async function readTestCaseGrid(docPath: string): Promise<TestCaseGrid | null> {
  const overlay = readOverlay(docPath);
  if (overlay) return { sheets: overlay.sheets, edited: true };
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

/** Who made an edit — stamped into "Edited By" and recorded by id for renames. */
export interface EditAuthor {
  id: string;
  name: string;
}

/**
 * Edit one cell and stamp that row's "Updated At" + "Edited By" (when the sheet
 * has those columns), persisting to the `.edited.json` overlay. Row 0 is the
 * header and is never editable. `author` fills "Edited By" with the Hub user's
 * display name and records the row→user id so a later rename can rewrite it.
 * Returns the updated grid, or null when the target is invalid.
 */
export async function editTestCaseCell(
  docPath: string,
  sheetIdx: number,
  rowIdx: number,
  colIdx: number,
  value: string,
  author?: EditAuthor,
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
    row[uaIdx] = stampNow();
  }
  const editors = stampAuthor(sheet, header, sheetIdx, rowIdx, docPath, author);
  writeOverlay(docPath, grid.sheets, editors ? { editors } : undefined);
  return { sheets: grid.sheets, edited: true };
}

/**
 * Write `author`'s display name into the row's "Edited By" and return the
 * overlay's editors map with this row attributed to the author's id. Returns
 * undefined when there is no author or no such column, leaving the map untouched.
 */
function stampAuthor(
  sheet: TestCaseSheet,
  header: string[],
  sheetIdx: number,
  rowIdx: number,
  docPath: string,
  author?: EditAuthor,
): Record<string, string> | undefined {
  if (!author) return undefined;
  const ebIdx = headerIndex(header, EDITED_BY_HEADER);
  if (ebIdx < 0) return undefined;
  const row = sheet.rows[rowIdx];
  if (!row) return undefined;
  while (row.length <= ebIdx) row.push('');
  row[ebIdx] = author.name;
  const editors = { ...(readOverlay(docPath)?.editors ?? {}) };
  editors[editorKey(sheetIdx, rowIdx)] = author.id;
  return editors;
}

/** Append a blank row to a sheet, persisting to the overlay. */
export async function addTestCaseRow(
  docPath: string,
  sheetIdx: number,
  author?: EditAuthor,
): Promise<TestCaseGrid | null> {
  const grid = await readTestCaseGrid(docPath);
  const sheet = grid?.sheets[sheetIdx];
  if (!grid || !sheet) return null;
  const header = sheet.rows[0] ?? [];
  const width = header.length;
  sheet.rows.push(new Array<string>(width).fill(''));
  const editors = stampAuthor(sheet, header, sheetIdx, sheet.rows.length - 1, docPath, author);
  writeOverlay(docPath, grid.sheets, editors ? { editors } : undefined);
  return { sheets: grid.sheets, edited: true };
}

/**
 * Rewrite every "Edited By" cell attributed to `userId` (via the overlay's
 * `editors` map) to `newName`, across the given overlay-backed docs. Name-based
 * matching is deliberately avoided — two users can share a display name, and the
 * id map is exact. Returns how many rows and docs changed.
 */
export function renameEditedBy(
  docPaths: string[],
  userId: string,
  newName: string,
): { rowsRenamed: number; docsTouched: number } {
  let rowsRenamed = 0;
  let docsTouched = 0;
  for (const docPath of docPaths) {
    const overlay = readOverlay(docPath);
    if (!overlay?.editors) continue;
    let changed = 0;
    for (const [key, id] of Object.entries(overlay.editors)) {
      if (id !== userId) continue;
      const [sheetPart, rowPart] = key.split(':');
      const sheet = overlay.sheets[Number(sheetPart)];
      const row = sheet?.rows[Number(rowPart)];
      if (!sheet || !row) continue;
      const ebIdx = headerIndex(sheet.rows[0] ?? [], EDITED_BY_HEADER);
      if (ebIdx < 0) continue;
      while (row.length <= ebIdx) row.push('');
      if (row[ebIdx] === newName) continue;
      row[ebIdx] = newName;
      changed++;
    }
    if (changed === 0) continue;
    writeOverlay(docPath, overlay.sheets, { editors: overlay.editors });
    rowsRenamed += changed;
    docsTouched++;
  }
  return { rowsRenamed, docsTouched };
}

const ID_HEADER = 'Test Case ID';
const STATUS_HEADER = 'Status';

function headerIndex(header: string[], name: string): number {
  return header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
}

/**
 * Map a run's per-case results onto each matching doc row's own columns —
 * Status (Pass/Fail), Actual Result (the failure's first line, cleared on pass),
 * Updated At, and Edited By — persisting to the `.edited.json` overlay. The
 * source xlsx/csv is never touched. Those are the machine-owned columns (brain
 * LESS-014), which is why a sync may overwrite them; every author-owned column
 * is left alone, as is any row with no matching run result.
 *
 * `author` is the Hub user recorded as having produced this result. A reader of
 * the doc needs a person next to a Pass/Fail, not a script name, and stamping it
 * on every sync (automatic or manual) keeps the column deterministic. Omitted
 * only when no name has been set yet, in which case Edited By is left as-is.
 *
 * Returns the updated grid + how many rows matched, or null when unreadable.
 */
export async function applyRunStatus(
  docPath: string,
  resultByCaseId: Record<string, TestCaseRunResult>,
  runAt?: string,
  author?: EditAuthor,
): Promise<{ grid: TestCaseGrid; matched: number; total: number } | null> {
  const grid = await readTestCaseGrid(docPath);
  if (!grid) return null;
  const at = new Date();
  // Cells are read by people (local `DD/MM/YYYY HH:mm:ss`); the overlay's own
  // `lastRunAt` metadata stays a machine-readable ISO instant.
  const cellStamp = stampNow(at);
  const nowIso = at.toISOString();
  const editors = { ...(readOverlay(docPath)?.editors ?? {}) };
  let matched = 0;
  let total = 0;
  for (const [sheetIdx, sheet] of grid.sheets.entries()) {
    const header = sheet.rows[0] ?? [];
    const idIdx = headerIndex(header, ID_HEADER);
    const statusIdx = headerIndex(header, STATUS_HEADER);
    if (idIdx < 0 || statusIdx < 0) continue;
    const uaIdx = updatedAtIndex(header);
    const actualIdx = headerIndex(header, ACTUAL_RESULT_HEADER);
    const ebIdx = author ? headerIndex(header, EDITED_BY_HEADER) : -1;
    for (let r = 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r];
      if (!row) continue;
      total++;
      const id = (row[idIdx] ?? '').trim();
      const outcome = id ? resultByCaseId[id] : undefined;
      if (!outcome) continue;
      const widest = Math.max(statusIdx, uaIdx, actualIdx, ebIdx);
      while (row.length <= widest) row.push('');
      row[statusIdx] = outcome.status === 'passed' ? 'Pass' : 'Fail';
      if (actualIdx >= 0) row[actualIdx] = outcome.status === 'failed' ? (outcome.error ?? '') : '';
      if (uaIdx >= 0) row[uaIdx] = cellStamp;
      if (author && ebIdx >= 0) {
        row[ebIdx] = author.name;
        editors[editorKey(sheetIdx, r)] = author.id;
      }
      matched++;
    }
  }
  if (matched > 0) writeOverlay(docPath, grid.sheets, { editors, lastRunAt: runAt ?? nowIso });
  return { grid: { sheets: grid.sheets, edited: matched > 0 || grid.edited }, matched, total };
}

/**
 * Modules of a project that can own a test-case doc, discovered from the two
 * places a module actually exists: its automation specs
 * (`automations/specs/<module>/`) and its docs folder (`docs/<module>/`). A
 * module already holding a `<module>_test-case.*` doc reports its `docRelPath`,
 * which is what lets the create flow refuse a duplicate.
 */
export function listTestCaseModules(projectDir: string): TestCaseModule[] {
  const specDirs = safeDirNames(path.join(projectDir, 'automations', 'specs'));
  const docDirs = safeDirNames(path.join(projectDir, 'docs'));
  const docs = listTestCaseDocs(projectDir);
  const names = [...new Set([...specDirs, ...docDirs])].sort((a, b) => a.localeCompare(b));
  return names.map((name) => {
    const inSpecs = specDirs.includes(name);
    const inDocs = docDirs.includes(name);
    const existing = docs.find((d) => d.relPath.startsWith(`docs/${name}/`));
    return {
      name,
      source: inSpecs && inDocs ? 'both' : inSpecs ? 'spec' : 'docs',
      ...(existing ? { docRelPath: existing.relPath } : {}),
    };
  });
}

/** Immediate subdirectory names of `dir`, hidden/skipped dirs excluded. Never throws. */
function safeDirNames(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
}
