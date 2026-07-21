import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseRunSummary,
  type RunRecord,
  type RunRequest,
  type RunStatus,
  type WsServerEvent,
} from '@hub/shared';
import { nanoid } from 'nanoid';
import { BASH_PATH, WORKSPACE_ROOT } from '../config.js';
import { historyStore } from './history-store.js';
import { invalidateReportsCache } from './reports.js';
import { webhookService } from './webhooks.js';
import { createKillJob, type KillJob } from './win-job.js';

const DEFAULT_MAX_CONCURRENCY = 2;
/**
 * Per-run live output buffer ceiling. We keep a sliding window so reconnect
 * always shows the most recent activity even on long-running load tests
 * that emit hundreds of MB of stdout. The full output is still streamed
 * over WebSocket in real time; only the in-memory replay buffer is bounded.
 */
const OUTPUT_BUFFER_LIMIT = 1024 * 1024; // 1 MiB

/**
 * How many finished runs keep their output buffer + record in memory for late
 * subscribers and reconnects. A fast-finishing run often completes before the
 * client's WebSocket `subscribe` lands; without this its buffer would already
 * be gone, so the live view shows no detail and only the *next* run appears to
 * work. Retaining the last N lets the subscribe-time replay backfill it.
 * ponytail: bounded by entry COUNT, not bytes — worst case N × OUTPUT_BUFFER_LIMIT.
 * Upgrade path: switch to a byte-budgeted LRU if memory ever becomes a concern.
 */
const RECENT_FINISHED_LIMIT = 20;

/**
 * Grace period after a cancel before the run is force-finalized when the
 * child's `close` never arrives.
 *
 * On Windows + Git Bash the real worker processes (task → node → browser) are
 * reparented away from the tracked `bash -c` pid, so `taskkill /T /F` reaps
 * only the shell layer and the orphaned workers keep the child's stdio pipes
 * open. Node then never emits `close`, so without this fallback the run sticks
 * on `running` forever and the UI "Stop" appears to do nothing. When `close`
 * does fire first (POSIX, or a clean Windows tree) `finishRun`'s
 * double-finalize guard makes this a no-op.
 */
const CANCEL_FINALIZE_GRACE_MS = 5000;

/**
 * Filesystem prefix for a silent run's ephemeral output directory. The run id
 * is appended to form `os.tmpdir()/hub-silent-<id>`. The directory exists only
 * for the lifetime of the run and is removed by `purgeRunArtifacts`, so a
 * silent run never touches the persistent `outputs/` tree.
 */
const SILENT_TMP_PREFIX = 'hub-silent-';

/** Resolve the ephemeral temp dir path for a silent run id. */
function silentTmpDirFor(id: string): string {
  return path.join(os.tmpdir(), `${SILENT_TMP_PREFIX}${id}`);
}

interface ActiveRun {
  record: RunRecord;
  child: ChildProcess;
  /** Buffered terminal output for reconnection replay (size-bounded). */
  outputBuffer: string;
  /** True when the buffer has been truncated at least once. */
  outputTruncated: boolean;
  /** True when the run requested silent mode (no trace). */
  silent: boolean;
  /**
   * Absolute path to the ephemeral temp dir for a silent run's output, or
   * `null` for a normal run. Created on spawn, deleted in `purgeRunArtifacts`.
   */
  silentTmpDir: string | null;
  /**
   * Set to `true` by `cancel(id)` when a cancellation has been requested for
   * this run. The close handler consults it so the terminal status is
   * `cancelled` regardless of how the OS reports the kill (R7.3). This matters
   * on Windows where `taskkill /F` produces a non-zero exit code and no
   * signal, which would otherwise be misclassified as `failed`.
   */
  cancelRequested: boolean;
  /**
   * Windows Job Object enrolling this run's whole process tree, or `null`
   * off-Windows / when the job could not be created. Terminating the job reaps
   * every descendant — including workers Git Bash reparents away from
   * `child.pid`, which `taskkill /T` cannot reach.
   */
  killJob: KillJob | null;
}

interface QueuedRun {
  record: RunRecord;
  request: RunRequest;
}

/** Append `chunk` to `run.outputBuffer`, trimming from the head when over the cap. */
function appendBounded(run: ActiveRun, chunk: string): void {
  run.outputBuffer += chunk;
  if (run.outputBuffer.length <= OUTPUT_BUFFER_LIMIT) return;
  run.outputBuffer = run.outputBuffer.slice(-OUTPUT_BUFFER_LIMIT);
  run.outputTruncated = true;
}

/** Render a run's buffer for replay, prefixing a notice when it was truncated. */
function formatOutputBuffer(outputBuffer: string, outputTruncated: boolean): string {
  if (!outputTruncated) return outputBuffer;
  return `\x1b[33m[Hub] Output truncated to last ${OUTPUT_BUFFER_LIMIT} bytes\x1b[0m\n${outputBuffer}`;
}

/** Cross-platform process-tree kill. Awaits taskkill on Windows. */
async function killProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) {
    child.kill('SIGINT');
    return;
  }
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const tk = spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true });
      tk.on('error', () => {
        // Last-resort fallback if taskkill is missing.
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        resolve();
      });
      tk.on('close', () => resolve());
    });
    return;
  }
  // POSIX: kill the process group leader.
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

class RunnerService extends EventEmitter {
  private active = new Map<string, ActiveRun>();
  private queue: QueuedRun[] = [];
  /**
   * Output + record of recently finished (non-silent) runs, kept so a late
   * subscriber or reconnect can replay them (see RECENT_FINISHED_LIMIT).
   * Insertion-ordered; the oldest entry is evicted once over the cap.
   */
  private recentlyFinished = new Map<string, { record: RunRecord; output: string }>();
  private maxConcurrency: number = DEFAULT_MAX_CONCURRENCY;
  /**
   * Maintained incrementally on `run-finished`. Lets `/api/runs/last-status`
   * return without re-iterating history on every poll.
   */
  private lastStatusByProject = new Map<string, { status: string; endedAt: string }>();

  constructor() {
    super();
    // Seed last-status map from existing history.
    for (const r of historyStore.getAll()) {
      if (!r.endedAt) continue;
      const key = `${r.request.tool}/${r.request.type}/${r.request.project}`;
      const prev = this.lastStatusByProject.get(key);
      if (!prev || (prev.endedAt ?? '') < r.endedAt) {
        this.lastStatusByProject.set(key, { status: r.status, endedAt: r.endedAt });
      }
    }
  }

  setMaxConcurrency(n: number): void {
    this.maxConcurrency = Math.max(1, n);
    this.drainQueue();
  }

  getMaxConcurrency(): number {
    return this.maxConcurrency;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getQueue(): QueuedRun[] {
    return [...this.queue];
  }

  reorderQueue(runIds: string[]): boolean {
    if (runIds.length !== this.queue.length) return false;
    const map = new Map(this.queue.map((q) => [q.record.id, q]));
    const reordered: QueuedRun[] = [];
    for (const id of runIds) {
      const item = map.get(id);
      if (!item) return false;
      reordered.push(item);
    }
    this.queue = reordered;
    return true;
  }

  promoteInQueue(id: string): boolean {
    const idx = this.queue.findIndex((q) => q.record.id === id);
    if (idx <= 0) return idx === 0;
    const removed = this.queue.splice(idx, 1);
    if (removed[0]) this.queue.unshift(removed[0]);
    return true;
  }

  removeFromQueue(id: string): boolean {
    const idx = this.queue.findIndex((q) => q.record.id === id);
    if (idx === -1) return false;
    this.queue.splice(idx, 1);
    return true;
  }

  /**
   * Enqueue or spawn a run for `req` using the pre-built `command`. The command
   * is constructed by the caller (run route / scheduler) via the async
   * `command-builder`, keeping this method synchronous so the spawn/queue
   * lifecycle stays in one tick.
   */
  start(req: RunRequest, command: string): RunRecord {
    const id = nanoid(10);
    const record: RunRecord = {
      id,
      request: req,
      command,
      status: 'pending',
      startedAt: new Date().toISOString(),
    };

    if (this.active.size >= this.maxConcurrency) {
      // Queue the run
      this.queue.push({ record, request: req });
      this.emitEvent({ kind: 'run-started', runId: id, record });
      return record;
    }

    this.spawn(record);
    return record;
  }

  private spawn(record: RunRecord): void {
    const command = record.command;
    record.status = 'running';

    const silent = record.request.silent === true;

    // For silent runs, create an ephemeral temp dir to absorb any output the
    // task would otherwise write under outputs/. It is deleted in
    // purgeRunArtifacts so the persistent outputs/ tree never changes (R6.4).
    let silentTmpDir: string | null = null;
    if (silent) {
      silentTmpDir = silentTmpDirFor(record.id);
      try {
        fs.mkdirSync(silentTmpDir, { recursive: true });
      } catch {
        // Non-fatal: the run still proceeds; purge is best-effort either way.
        silentTmpDir = null;
      }
    }

    // Strip pnpm internals from PATH (same trick scripts/runner.ts uses).
    // PYTHONUNBUFFERED=1 forces line-buffered stdout from Python tools (Robot
    // Framework) so the Hub streams their output live instead of in big blocks
    // when stdout is a pipe (not a TTY).
    const env: Record<string, string | undefined> = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
    };
    if (env.PATH) {
      env.PATH = env.PATH.split(path.delimiter)
        .filter((p) => !p.includes('@pnpm'))
        .join(path.delimiter);
    }
    // Point a silent run's output at its ephemeral temp dir. The task layer
    // reads HUB_SILENT_OUTPUT_DIR when present; absent it falls back to
    // outputs/. Either way purgeRunArtifacts removes the temp dir afterwards.
    if (silent && silentTmpDir) {
      env.HUB_SILENT_OUTPUT_DIR = silentTmpDir;
    }

    const child = spawn(command, {
      shell: BASH_PATH,
      cwd: WORKSPACE_ROOT,
      env,
      windowsHide: true,
    });

    // Enroll the run in a Windows Job Object so cancellation can reap the whole
    // tree even when Git Bash reparents the real workers away from `child.pid`
    // (taskkill /T misses them). Best-effort: stays null off-Windows or on any
    // failure, in which case cancel() falls back to taskkill. Assigned
    // synchronously here so descendants spawned by the shell inherit the job.
    let killJob: KillJob | null = null;
    const job = createKillJob();
    if (job) {
      if (child.pid && job.assign(child.pid)) {
        killJob = job;
      } else {
        job.release(); // couldn't enroll the process — drop it, use taskkill
      }
    }

    const id = record.id;
    const activeRun: ActiveRun = {
      record,
      child,
      outputBuffer: '',
      outputTruncated: false,
      silent,
      silentTmpDir,
      cancelRequested: false,
      killJob,
    };
    this.active.set(id, activeRun);
    this.emitEvent({ kind: 'run-started', runId: id, record });

    child.stdout?.on('data', (buf: Buffer) => {
      const chunk = buf.toString('utf8');
      const run = this.active.get(id);
      if (run) appendBounded(run, chunk);
      // R6.2: never stream stdout for a silent run.
      if (!silent) this.emitEvent({ kind: 'run-stdout', runId: id, chunk });
    });
    child.stderr?.on('data', (buf: Buffer) => {
      const chunk = buf.toString('utf8');
      const run = this.active.get(id);
      if (run) appendBounded(run, `\x1b[31m${chunk}\x1b[0m`);
      // R6.2: never stream stderr for a silent run.
      if (!silent) this.emitEvent({ kind: 'run-stderr', runId: id, chunk });
    });

    child.on('close', (code, signal) => {
      // A cancellation requested via cancel(id) always yields a `cancelled`
      // terminal status, even on Windows where taskkill /F reports a non-zero
      // exit code and no signal (which would otherwise look like `failed`).
      // POSIX SIGINT/SIGTERM are still treated as cancellations too (R7.3).
      const cancelled =
        this.active.get(id)?.cancelRequested === true ||
        signal === 'SIGINT' ||
        signal === 'SIGTERM';
      const finalStatus: RunStatus = cancelled ? 'cancelled' : code === 0 ? 'passed' : 'failed';
      this.finishRun(record, finalStatus, typeof code === 'number' ? code : undefined);
    });

    // A spawn-level error (e.g. shell missing) is still a terminal outcome.
    // Route it through the same gate so no trace logic diverges (R6.6).
    child.on('error', () => {
      if (!this.active.has(id)) return;
      this.finishRun(record, 'error', undefined);
    });
  }

  /**
   * Single terminal path for every run regardless of outcome
   * (passed/failed/cancelled/error). All persistence side effects are gated
   * by `silent` here so a silent run leaves no trace (R6.1–R6.6, R13.*),
   * while still flowing through one code path (R6.6).
   */
  private finishRun(record: RunRecord, finalStatus: RunStatus, exitCode?: number): void {
    const id = record.id;
    // Guard against double-finalization (close + error can both fire).
    if (!this.active.has(id)) return;
    const silent = record.request.silent === true;

    // Parse the pass/fail/skip summary from the run's buffered output so it can
    // be persisted with the history record (drives the Reports "Cases" column).
    // Silent runs leave no trace, so skip it for them.
    const run = this.active.get(id);
    const summary = !silent && run ? (parseRunSummary(run.outputBuffer) ?? undefined) : undefined;

    const finished: RunRecord = {
      ...record,
      status: finalStatus,
      endedAt: new Date().toISOString(),
      ...(typeof exitCode === 'number' ? { exitCode } : {}),
      ...(summary ? { summary } : {}),
    };

    // Snapshot the live buffer before dropping the active entry so a late
    // subscriber / reconnect can still replay it. Silent runs leave no trace.
    if (!silent && run) {
      this.rememberFinished(
        id,
        finished,
        formatOutputBuffer(run.outputBuffer, run.outputTruncated),
      );
    }

    this.active.delete(id);
    // Close our Job Object handle. If the run was cancelled, terminate() already
    // closed it (this is a guarded no-op); for a normal finish this frees the
    // handle and, via KILL_ON_JOB_CLOSE, reaps any lingering stray descendants.
    run?.killJob?.release();

    if (!silent) {
      // History append (R6.1), last-status index (R6.3) and report cache
      // refresh (R6.4) only happen for non-silent runs.
      historyStore.append(finished);
      this.updateLastStatus(finished);
      invalidateReportsCache();
    } else {
      // R6.4/R6.5: drop the output buffer, active entry and ephemeral temp
      // dir immediately so nothing about the run remains in memory or on disk.
      this.purgeRunArtifacts(id);
    }

    // Always announce completion so schedulers/matrix/webhooks react. The
    // event itself carries no persisted trace for silent runs.
    this.emitEvent({ kind: 'run-finished', runId: id, record: finished });
    // Fire webhooks asynchronously
    webhookService.fireForRun(finished).catch(() => {});
    this.drainQueue();
  }

  /** Update the derived last-status index for a finished (non-silent) run. */
  private updateLastStatus(finished: RunRecord): void {
    const key = `${finished.request.tool}/${finished.request.type}/${finished.request.project}`;
    this.lastStatusByProject.set(key, {
      status: finished.status,
      endedAt: finished.endedAt ?? '',
    });
  }

  /**
   * Remove every in-memory and on-disk trace of a run: its live output
   * buffer, its active-list entry, and its ephemeral silent temp dir. Safe to
   * call for any run id (no-op when nothing is tracked). Synchronous removals
   * happen immediately; the temp-dir delete is fire-and-forget but scheduled
   * right away so it completes well within 1s (R6.5).
   */
  purgeRunArtifacts(id: string): void {
    const run = this.active.get(id);
    // Resolve the temp dir even if the active entry is already gone so a
    // late/duplicate purge still cleans up disk.
    const tmpDir = run?.silentTmpDir ?? silentTmpDirFor(id);
    this.active.delete(id);
    void fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  private drainQueue(): void {
    while (this.queue.length > 0 && this.active.size < this.maxConcurrency) {
      const next = this.queue.shift();
      if (next) this.spawn(next.record);
    }
  }

  cancel(id: string): boolean {
    const run = this.active.get(id);
    // R7.4: a run id that is not in the active list is rejected with `false`
    // and the active list is left untouched (the route then responds 404).
    if (!run) return false;
    // R7.3: record the cancel intent so the close handler marks this run as
    // `cancelled` within the 5s budget, even when the kill is reported by the
    // OS as a plain non-zero exit (Windows taskkill /F). This matches by run
    // identifier, so any active run can be cancelled — not only the silent run
    // currently executing.
    run.cancelRequested = true;
    // Reap the whole process tree without blocking the caller — the close
    // handler finalizes state. Prefer the Job Object (terminates reparented
    // workers that `taskkill /T` cannot reach); fall back to taskkill when no
    // job was enrolled (off-Windows or assignment failed).
    if (run.killJob) {
      run.killJob.terminate();
    } else {
      void killProcessTree(run.child).catch((err) => {
        console.error(`[runner] killProcessTree failed for run ${id}:`, err);
      });
    }
    // Fallback finalize: if `close` has not fired within the grace window
    // (orphaned/reparented workers on Windows keep the child's stdio open, so
    // Node never emits `close`), force the run to `cancelled` so the active
    // list and UI never stick on `running`. If `close` fired first the run is
    // already gone from `active` and finishRun's guard makes this a no-op.
    const timer = setTimeout(() => {
      const stuck = this.active.get(id);
      if (!stuck?.cancelRequested) return;
      // Detach live-output listeners so orphaned workers still holding the
      // pipe cannot emit stdout/stderr after the terminal run-finished event.
      stuck.child.stdout?.removeAllListeners('data');
      stuck.child.stderr?.removeAllListeners('data');
      this.finishRun(stuck.record, 'cancelled', undefined);
    }, CANCEL_FINALIZE_GRACE_MS);
    // Never let this timer keep the process alive at shutdown.
    timer.unref?.();
    return true;
  }

  getActive(): RunRecord[] {
    return [...this.active.values()].map((r) => r.record);
  }

  getOutputBuffer(id: string): string | null {
    const run = this.active.get(id);
    if (run) return formatOutputBuffer(run.outputBuffer, run.outputTruncated);
    // Fall back to a recently finished run so a late subscribe / reconnect can
    // still replay the output of a run that completed before it arrived.
    return this.recentlyFinished.get(id)?.output ?? null;
  }

  /**
   * Record of a recently finished run, or `undefined` once evicted/never seen.
   * Lets the WebSocket replay a terminal `run-finished` event to a client that
   * subscribed after the run had already completed.
   */
  getFinishedRecord(id: string): RunRecord | undefined {
    return this.recentlyFinished.get(id)?.record;
  }

  /** Retain a finished run's output + record, evicting the oldest over the cap. */
  private rememberFinished(id: string, record: RunRecord, output: string): void {
    this.recentlyFinished.set(id, { record, output });
    while (this.recentlyFinished.size > RECENT_FINISHED_LIMIT) {
      const oldest = this.recentlyFinished.keys().next().value;
      if (oldest === undefined) break;
      this.recentlyFinished.delete(oldest);
    }
  }

  getHistory(): RunRecord[] {
    return historyStore.getAll();
  }

  /**
   * O(1) lookup of the most recent finished run per tool/type/project.
   * Used by /api/runs/last-status (replaces a per-poll history scan).
   */
  getLastStatusByProject(): Record<string, { status: string; endedAt: string }> {
    return Object.fromEntries(this.lastStatusByProject);
  }

  /**
   * Forget the cached last-run status for a single project. Called when a
   * project is removed so its status never lingers in `/api/runs/last-status`
   * after its history rows are deleted.
   */
  forgetProject(tool: string, type: string, project: string): void {
    this.lastStatusByProject.delete(`${tool}/${type}/${project}`);
  }

  clearHistory(): void {
    historyStore.clear();
    this.lastStatusByProject.clear();
    this.recentlyFinished.clear();
  }

  private emitEvent(event: WsServerEvent): void {
    this.emit('event', event);
  }
}

export const runner = new RunnerService();
