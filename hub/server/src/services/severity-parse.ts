import fs from 'node:fs';
import path from 'node:path';
import {
  emptySeverityBreakdown,
  SEVERITY_LEVELS,
  type SeverityBreakdown,
  type SeverityLevel,
} from '@hub/shared';

// ===========================================================================
// Per-severity pass/fail tally parsed from a Playwright `results.json`.
// Shared by the report listing (reports.ts) and the run history route so both
// derive the severity-weighted score from the same source, mtime-cached.
// ===========================================================================

/** Minimal shape of the Playwright JSON reporter output we read. */
interface PwSpec {
  ok?: boolean;
  tags?: string[];
}
interface PwSuite {
  specs?: PwSpec[];
  suites?: PwSuite[];
}

const SEVERITY_SET = new Set<string>(SEVERITY_LEVELS);

/** First severity tag on a spec (tags come with or without a leading `@`). */
function severityOf(tags: string[] | undefined): SeverityLevel | undefined {
  for (const raw of tags ?? []) {
    const tag = raw.replace(/^@/, '').toLowerCase();
    if (SEVERITY_SET.has(tag)) return tag as SeverityLevel;
  }
  return undefined;
}

function collectSpecs(suite: PwSuite, out: PwSpec[]): void {
  for (const spec of suite.specs ?? []) out.push(spec);
  for (const child of suite.suites ?? []) collectSpecs(child, out);
}

const severityCache = new Map<string, { mtimeMs: number; breakdown: SeverityBreakdown | null }>();
const MAX_RESULTS_JSON_BYTES = 25 * 1024 * 1024;

/**
 * Parse the per-severity passed/failed tally from a Playwright `results.json`.
 * Cached by file mtime because the file can be large and callers re-scan often.
 * Best-effort: a missing/oversized/malformed file yields `null` (the caller
 * falls back to a plain pass rate) rather than throwing.
 */
export function parseSeverityBreakdown(resultsJsonPath: string): SeverityBreakdown | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resultsJsonPath);
  } catch {
    return null;
  }
  const cached = severityCache.get(resultsJsonPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.breakdown;

  let breakdown: SeverityBreakdown | null = null;
  if (stat.size <= MAX_RESULTS_JSON_BYTES) {
    try {
      const json = JSON.parse(fs.readFileSync(resultsJsonPath, 'utf8')) as { suites?: PwSuite[] };
      const specs: PwSpec[] = [];
      for (const suite of json.suites ?? []) collectSpecs(suite, specs);
      const acc = emptySeverityBreakdown();
      let any = false;
      for (const spec of specs) {
        const level = severityOf(spec.tags);
        if (!level) continue;
        any = true;
        if (spec.ok) acc[level].passed += 1;
        else acc[level].failed += 1;
      }
      breakdown = any ? acc : null;
    } catch {
      breakdown = null;
    }
  }
  severityCache.set(resultsJsonPath, { mtimeMs: stat.mtimeMs, breakdown });
  return breakdown;
}

/**
 * Resolve a Playwright report's `results.json` (written by the `json` reporter
 * into the run's time dir) from the report's HTML path, then parse it.
 * `reportPath` is `.../<time>/html-results/index.html`; `results.json` sits in
 * `<time>/`. Returns `null` when the path shape is unexpected or the file is
 * missing/unparseable.
 */
export function severityFromReportPath(reportPath: string | undefined): SeverityBreakdown | null {
  if (!reportPath) return null;
  const timeDir = path.dirname(path.dirname(reportPath));
  return parseSeverityBreakdown(path.join(timeDir, 'results.json'));
}
