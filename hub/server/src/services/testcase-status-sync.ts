import path from 'node:path';
import type { RunRecord, TestCaseRunResult, WsServerEvent } from '@hub/shared';
import { TOOLS_DIR } from '../config.js';
import { getHubUser } from './hub-user.js';
import { isUnder } from './path-guard.js';
import { invalidateReportsCache, reportEntryByRun } from './reports.js';
import { parseRunOutcomes } from './run-compare.js';
import { runner } from './runner.js';
import { applyRunStatus, listTestCaseDocs } from './testcases.js';

/** Per-doc outcome of one sync pass. */
export interface DocSyncResult {
  /** Absolute path of the source doc whose overlay was updated. */
  docPath: string;
  matched: number;
  total: number;
}

/** Project directory for a run/doc target, using the tools/ layout the Hub scans. */
export function projectDirFor(tool: string, type: string, project: string): string {
  return path.join(TOOLS_DIR, tool, 'projects', type, project);
}

/**
 * Map every test-case id a run reported to its outcome.
 *
 * A run outcome contributes TWO kinds of id: the spec's own id (the
 * `"<caseId>: …"` title prefix) and every `TC-*` cover tag it declares — an E2E
 * spec usually covers several doc cases, so cover tags are what make the
 * doc↔spec link work (brain LESS-066). Returns an empty map when the run has no
 * parseable `results.json`.
 */
export function resultMapFromReport(
  reportPath: string | undefined,
): Record<string, TestCaseRunResult> {
  const byCaseId: Record<string, TestCaseRunResult> = {};
  for (const outcome of parseRunOutcomes(reportPath) ?? []) {
    const ids = new Set<string>();
    const ownId = outcome.title.split(':')[0]?.trim();
    if (ownId) ids.add(ownId);
    for (const tag of outcome.tags ?? []) if (tag.startsWith('TC-')) ids.add(tag);
    for (const id of ids) {
      byCaseId[id] = {
        status: outcome.status === 'passed' ? 'passed' : 'failed',
        ...(outcome.error ? { error: outcome.error } : {}),
      };
    }
  }
  return byCaseId;
}

/**
 * Resolve the report a finished run produced. `RunRecord.reportPath` is declared
 * but never written by the runner, so it is resolved here from the reports
 * listing (tool/type/project + nearest-time match). Falls back to the record's
 * own `reportPath` when a caller has already set one.
 */
export async function resolveReportPath(record: RunRecord): Promise<string | undefined> {
  if (record.reportPath) return record.reportPath;
  const matched = await reportEntryByRun([record]);
  return matched.get(record.id)?.reportPath;
}

/**
 * Map a run's results onto every test-case doc of its project, writing only the
 * `.edited.json` overlays. Docs whose ids do not appear in the run are left
 * untouched (`matched: 0`) — that is a coverage gap, not a failure.
 */
export async function syncDocsForRun(
  record: RunRecord,
  reportPath?: string,
): Promise<{ results: DocSyncResult[]; reportPath?: string; runAt: string | null }> {
  const resolved = reportPath ?? (await resolveReportPath(record));
  const runAt = record.endedAt ?? record.startedAt ?? null;
  const resultByCaseId = resultMapFromReport(resolved);
  if (Object.keys(resultByCaseId).length === 0) {
    return { results: [], ...(resolved ? { reportPath: resolved } : {}), runAt };
  }
  const { tool, type, project } = record.request;
  const projectDir = projectDirFor(tool, type, project);
  if (!isUnder(TOOLS_DIR, projectDir)) return { results: [], runAt };
  // Same author as the manual sync, so "Edited By" never depends on whether the
  // mapping happened automatically or by button.
  const user = getHubUser();
  const author = user ? { id: user.id, name: user.name } : undefined;
  const results: DocSyncResult[] = [];
  for (const doc of listTestCaseDocs(projectDir)) {
    const applied = await applyRunStatus(doc.path, resultByCaseId, runAt ?? undefined, author);
    if (applied)
      results.push({ docPath: doc.path, matched: applied.matched, total: applied.total });
  }
  return { results, ...(resolved ? { reportPath: resolved } : {}), runAt };
}

/**
 * Auto-sync run results into test-case docs when a run finishes.
 *
 * Before this, mapping only happened when the user pressed "Sync last-run
 * status" — and even then it could never match, because the manual path filtered
 * history on `RunRecord.reportPath`, which nothing ever sets. Runs therefore
 * completed without creating or updating any `.edited.json`.
 *
 * Silent runs are skipped by contract (they must leave no trace on disk).
 */
/** Delays before each attempt to locate the finished run's report. */
const REPORT_WAIT_STEPS_MS = [0, 2000, 5000];

/**
 * Sync as soon as the run's report is on disk. The report directory is promoted
 * by the task itself, and on Windows that move is retried around file locks, so
 * it can land slightly after the process exits. We therefore poll a few times
 * instead of giving up on the first miss; a run that produced no report at all
 * (cancelled early, non-Playwright tool) simply falls through.
 */
async function syncWhenReportLands(record: RunRecord): Promise<void> {
  for (const [attempt, delayMs] of REPORT_WAIT_STEPS_MS.entries()) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      // The reports listing is cached for 10s; without dropping it here a retry
      // would keep reading the same pre-promotion snapshot.
      invalidateReportsCache();
    }
    const reportPath = await resolveReportPath(record);
    if (!reportPath) continue;
    await syncDocsForRun(record, reportPath);
    return;
  }
}

let started = false;

/**
 * Subscribe to run completion so results land in the docs' overlays without the
 * user pressing anything.
 *
 * Before this, mapping only happened on "Sync last-run status" — and even then it
 * could never match, because that path filtered history on
 * `RunRecord.reportPath`, which nothing ever sets. Runs therefore finished
 * without creating or updating any `.edited.json`.
 *
 * Idempotent, and silent runs are skipped by contract (they leave no trace).
 */
export function startTestCaseStatusSync(): void {
  if (started) return;
  started = true;
  runner.on('event', (event: WsServerEvent) => {
    if (event.kind !== 'run-finished') return;
    if (event.record.request.silent === true) return;
    void syncWhenReportLands(event.record).catch(() => {
      // Advisory: a doc that cannot be written must never fail a run.
    });
  });
}
