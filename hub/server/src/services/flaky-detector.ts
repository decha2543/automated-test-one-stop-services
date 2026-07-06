import {
  type FlakyReport,
  type FlakyTestEntry,
  parseTagExpr,
  type RunRecord,
  type RunStatus,
  type ToolId,
} from '@hub/shared';
import { loadJson, saveJson } from './persistence.js';
import { runner } from './runner.js';

const FLAKY_FILE = 'flaky-tests.json';
const MIN_RUNS_FOR_DETECTION = 3;
const FLAKY_THRESHOLD = 20; // score >= 20 = flaky

interface FlakyData {
  tests: Record<string, FlakyTestEntry>;
  lastAnalyzed: string;
  /** Test keys the user dismissed — preserved across re-analysis so a dismissed
   * test does not reappear (GET /api/flaky re-analyzes on every read). */
  dismissed?: string[];
}

function load(): FlakyData {
  return loadJson<FlakyData>(FLAKY_FILE, { tests: {}, lastAnalyzed: '', dismissed: [] });
}

function save(data: FlakyData): void {
  saveJson(FLAKY_FILE, data);
}

function calculateFlakinessScore(statuses: RunStatus[]): number {
  if (statuses.length < 2) return 0;
  let transitions = 0;
  for (let i = 1; i < statuses.length; i++) {
    if (statuses[i] !== statuses[i - 1]) transitions++;
  }
  return Math.round((transitions / (statuses.length - 1)) * 100);
}

function buildTestKey(tool: ToolId, type: string, project: string, tag: string): string {
  return `${tool}/${type}/${project}/${tag}`;
}

class FlakyDetectorService {
  analyze(): FlakyReport {
    const history = runner.getHistory();
    const data = load();

    const grouped = new Map<
      string,
      { runs: RunRecord[]; tool: ToolId; type: string; project: string; tag: string }
    >();

    for (const run of history) {
      if (!run.request.tag || !run.endedAt) continue;
      const tags = parseTagExpr(run.request.tag);
      for (const tag of tags) {
        const key = buildTestKey(run.request.tool, run.request.type, run.request.project, tag);
        if (!grouped.has(key)) {
          grouped.set(key, {
            runs: [],
            tool: run.request.tool,
            type: run.request.type,
            project: run.request.project,
            tag,
          });
        }
        grouped.get(key)?.runs.push(run);
      }
    }

    const tests: Record<string, FlakyTestEntry> = {};

    for (const [key, { runs, tool, type, project, tag }] of grouped) {
      const sorted = runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const recentStatuses = sorted.slice(0, 20).map((r) => r.status);
      const completedStatuses = recentStatuses.filter((s) => s === 'passed' || s === 'failed');

      if (completedStatuses.length < MIN_RUNS_FOR_DETECTION) continue;

      const firstRun = sorted[0] as (typeof sorted)[number];
      const passes = completedStatuses.filter((s) => s === 'passed').length;
      const failures = completedStatuses.filter((s) => s === 'failed').length;
      const flakinessScore = calculateFlakinessScore(completedStatuses);

      tests[key] = {
        testId: tag,
        project,
        tool,
        type,
        totalRuns: completedStatuses.length,
        passes,
        failures,
        flakinessScore,
        recentStatuses: recentStatuses.slice(0, 10),
        lastSeen: firstRun.endedAt ?? firstRun.startedAt,
        isFlaky: flakinessScore >= FLAKY_THRESHOLD,
      };
    }

    // Preserve user dismissals across re-analysis (GET re-analyzes on every
    // read), so a dismissed test never reappears as flaky.
    const dismissed = new Set(data.dismissed ?? []);
    for (const key of dismissed) {
      if (tests[key]) tests[key].isFlaky = false;
    }

    const stabilized: FlakyTestEntry[] = [];
    for (const [key, oldEntry] of Object.entries(data.tests)) {
      if (oldEntry.isFlaky && tests[key] && !tests[key].isFlaky) {
        stabilized.push(tests[key]);
      }
    }

    const newData: FlakyData = {
      tests,
      lastAnalyzed: new Date().toISOString(),
      dismissed: [...dismissed],
    };
    save(newData);

    const flakyTests = Object.values(tests)
      .filter((t) => t.isFlaky)
      .sort((a, b) => b.flakinessScore - a.flakinessScore);

    return {
      generatedAt: newData.lastAnalyzed,
      totalTests: Object.keys(tests).length,
      flakyTests,
      stabilizedTests: stabilized,
    };
  }

  getReport(): FlakyReport {
    const data = load();
    const flakyTests = Object.values(data.tests)
      .filter((t) => t.isFlaky)
      .sort((a, b) => b.flakinessScore - a.flakinessScore);

    return {
      generatedAt: data.lastAnalyzed || new Date().toISOString(),
      totalTests: Object.keys(data.tests).length,
      flakyTests,
      stabilizedTests: [],
    };
  }

  getByProject(tool: ToolId, type: string, project: string): FlakyTestEntry[] {
    const data = load();
    return Object.values(data.tests).filter(
      (t) => t.tool === tool && t.type === type && t.project === project && t.isFlaky,
    );
  }

  dismiss(testKey: string): boolean {
    const data = load();
    const existed = data.tests[testKey] !== undefined;
    const dismissed = new Set(data.dismissed ?? []);
    dismissed.add(testKey);
    data.dismissed = [...dismissed];
    if (existed) {
      const entry = data.tests[testKey];
      if (entry) entry.isFlaky = false;
    }
    save(data);
    return existed;
  }
}

export const flakyDetector = new FlakyDetectorService();
