import fs from 'node:fs';
import path from 'node:path';
import type {
  CompareCategory,
  CompareRow,
  CompareSide,
  RunCompareResult,
  RunRecord,
  TestStatus,
} from '@hub/shared';

/** Minimal shape of the Playwright JSON reporter output we read. */
interface PwSpec {
  ok?: boolean;
  title?: string;
  id?: string;
  tags?: string[];
}
interface PwSuite {
  file?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}

/** One test's outcome, extracted from a run's result file. */
export interface RunOutcome {
  key: string;
  title: string;
  file?: string;
  status: TestStatus;
  /** Playwright tags on the spec (includes cover tags like `TC-<docId>`). */
  tags?: string[];
}

const MAX_RESULTS_JSON_BYTES = 25 * 1024 * 1024;

function collectOutcomes(suite: PwSuite, fileHint: string | undefined, out: RunOutcome[]): void {
  const file = suite.file ?? fileHint;
  for (const spec of suite.specs ?? []) {
    const title = spec.title ?? '(untitled)';
    // spec.id is a stable hash across runs of the same test; fall back to
    // file::title when a reporter omits it.
    const key = spec.id || `${file ?? ''}::${title}`;
    out.push({ key, title, file, status: spec.ok ? 'passed' : 'failed', tags: spec.tags ?? [] });
  }
  for (const child of suite.suites ?? []) collectOutcomes(child, file, out);
}

/**
 * Parse per-test outcomes from a run's Playwright `results.json` (written by the
 * `json` reporter into the run's time dir, sibling of `html-results/`).
 * `reportPath` is `.../<time>/html-results/index.html`; `results.json` sits in
 * `<time>/`. Best-effort: returns `null` when the path shape is unexpected or
 * the file is missing / oversized / unparseable.
 */
export function parseRunOutcomes(reportPath: string | undefined): RunOutcome[] | null {
  if (!reportPath) return null;
  const timeDir = path.dirname(path.dirname(reportPath));
  const resultsJsonPath = path.join(timeDir, 'results.json');
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resultsJsonPath);
  } catch {
    return null;
  }
  if (stat.size > MAX_RESULTS_JSON_BYTES) return null;
  try {
    const json = JSON.parse(fs.readFileSync(resultsJsonPath, 'utf8')) as { suites?: PwSuite[] };
    const out: RunOutcome[] = [];
    for (const suite of json.suites ?? []) collectOutcomes(suite, undefined, out);
    return out;
  } catch {
    return null;
  }
}

function emptyCounts(): Record<CompareCategory, number> {
  return { newlyFailed: 0, fixed: 0, stillFailing: 0, stillPassing: 0, added: 0, removed: 0 };
}

function categoryOf(a: TestStatus | undefined, b: TestStatus | undefined): CompareCategory {
  if (a && b) {
    if (a === 'passed' && b === 'failed') return 'newlyFailed';
    if (a === 'failed' && b === 'passed') return 'fixed';
    if (a === 'failed' && b === 'failed') return 'stillFailing';
    return 'stillPassing';
  }
  return a ? 'removed' : 'added';
}

// Most-actionable categories first (regressions surface at the top).
const CATEGORY_ORDER: CompareCategory[] = [
  'newlyFailed',
  'stillFailing',
  'fixed',
  'added',
  'removed',
  'stillPassing',
];

/**
 * Pure diff of two runs' per-test outcomes, matched across runs by the stable
 * {@link RunOutcome.key}. Rows are sorted with the most actionable categories
 * first, then by title.
 */
export function diffOutcomes(
  a: RunOutcome[],
  b: RunOutcome[],
): { rows: CompareRow[]; counts: Record<CompareCategory, number> } {
  const mapA = new Map(a.map((o) => [o.key, o]));
  const mapB = new Map(b.map((o) => [o.key, o]));
  const counts = emptyCounts();
  const rows: CompareRow[] = [];
  for (const key of new Set([...mapA.keys(), ...mapB.keys()])) {
    const oa = mapA.get(key);
    const ob = mapB.get(key);
    const category = categoryOf(oa?.status, ob?.status);
    counts[category] += 1;
    rows.push({
      key,
      title: ob?.title ?? oa?.title ?? key,
      file: ob?.file ?? oa?.file,
      category,
      a: oa?.status,
      b: ob?.status,
    });
  }
  rows.sort((x, y) => {
    const byCat = CATEGORY_ORDER.indexOf(x.category) - CATEGORY_ORDER.indexOf(y.category);
    return byCat !== 0 ? byCat : x.title.localeCompare(y.title);
  });
  return { rows, counts };
}

function tally(outcomes: RunOutcome[] | null): { total: number; passed: number; failed: number } {
  if (!outcomes) return { total: 0, passed: 0, failed: 0 };
  let passed = 0;
  for (const o of outcomes) if (o.status === 'passed') passed += 1;
  return { total: outcomes.length, passed, failed: outcomes.length - passed };
}

function toSide(run: RunRecord, t: { total: number; passed: number; failed: number }): CompareSide {
  return {
    runId: run.id,
    tool: run.request.tool,
    project: run.request.project,
    startedAt: run.startedAt,
    status: run.status,
    total: t.total,
    passed: t.passed,
    failed: t.failed,
  };
}

/** Compare two runs end-to-end into the client-facing DTO. */
export function compareRuns(runA: RunRecord, runB: RunRecord): RunCompareResult {
  const outcomesA = parseRunOutcomes(runA.reportPath);
  const outcomesB = parseRunOutcomes(runB.reportPath);
  const { rows, counts } = diffOutcomes(outcomesA ?? [], outcomesB ?? []);
  return {
    a: toSide(runA, tally(outcomesA)),
    b: toSide(runB, tally(outcomesB)),
    rows,
    counts,
    unavailable: outcomesA === null || outcomesB === null,
  };
}
