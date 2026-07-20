import type { RunSummary } from './run-summary.js';
import type { ToolId } from './tools.js';

export type RunMode = 'local' | 'docker';
export type HeadlessMode = 'headless' | 'headed';

export type PerformanceType =
  | 'TEST_PROTOCOL'
  | 'MINIMAL_LOAD'
  | 'LOAD'
  | 'STRESS'
  | 'ENDURANCE'
  | 'PEAK';

/** Request payload to start a test run. */
export interface RunRequest {
  tool: ToolId;
  type: string;
  project: string;
  mode: RunMode;
  /** Tag expression. For Playwright this is a regex; for Robot, a tag name. */
  tag?: string;
  headless?: HeadlessMode;
  extraArgs?: string;
  /** Disable Google Sheet usage logging. */
  noTrack?: boolean;
  /** Disable Local logging and report. */
  silent?: boolean;
  // k6-only
  section?: string;
  performanceType?: PerformanceType;
}

export type RunStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'skipped'
  | 'failed'
  | 'cancelled'
  | 'error';

export interface RunRecord {
  id: string;
  request: RunRequest;
  command: string;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  /** Path to primary HTML report, if produced. */
  reportPath?: string;
  /** Test-case counts parsed from the run output, when a summary was present. */
  summary?: RunSummary;
}

/**
 * A saved run-form config (macro/shortcut): a name plus the captured
 * `RunRequest`. Clicking a bookmark reloads its `config` into the run form.
 */
export interface Bookmark {
  id: string;
  /** Saved-config display name. */
  name: string;
  config: RunRequest;
  createdAt: string;
}

export interface QueueEntry {
  id: string;
  position: number;
  record: RunRecord;
}

// Matrix / Parallel Runs ------------------------------------------------------

export interface MatrixAxis {
  name: string;
  values: string[];
}

export interface MatrixRunRequest {
  baseConfig: RunRequest;
  axes: MatrixAxis[];
  maxParallel?: number;
}

export interface MatrixRunGroup {
  id: string;
  name: string;
  request: MatrixRunRequest;
  runIds: string[];
  status: 'pending' | 'running' | 'completed';
  startedAt: string;
  endedAt?: string;
  summary?: { passed: number; failed: number; total: number };
}

// WebSocket events -----------------------------------------------------------

export type WsServerEvent =
  | { kind: 'run-started'; runId: string; record: RunRecord }
  | { kind: 'run-stdout'; runId: string; chunk: string }
  | { kind: 'run-stderr'; runId: string; chunk: string }
  | { kind: 'run-finished'; runId: string; record: RunRecord }
  | {
      kind: 'schedule-finished';
      runId: string;
      scheduleId: string;
      /** Schedule name, or the schedule id when no name is set. */
      scheduleName: string;
      status: RunStatus;
      silent: boolean;
      /** Failure reason, when applicable. */
      message?: string;
    };

export type WsClientEvent =
  | {
      kind: 'subscribe';
      runId: string;
      /**
       * When true, the server replays the run's buffered output (and a terminal
       * `run-finished` event if it has already completed) right after
       * subscribing. Used by a fresh run so a fast-finishing run still shows its
       * detail, even though it may complete before this subscribe lands. Omitted
       * (false) by the reconnect path, which already fetches `/output` over HTTP.
       */
      replay?: boolean;
    }
  | { kind: 'cancel'; runId: string };
