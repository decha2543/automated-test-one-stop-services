import type { RunRequest, WsServerEvent } from '@hub/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit / integration tests for Task 5.8 — schedule + runner cancel.
 *
 * Covers acceptance criteria:
 *   R7.3  runner.cancel on an active run → status becomes 'cancelled' and the
 *         run leaves getActive() within budget
 *   R8.5  a silent schedule trigger is treated as a Silent_Run → no history
 *         growth and no output buffer left behind
 *   R8.6  scheduler stamps `lastRunAt` (ISO 8601) + `lastStatus = 'pending'`
 *         when it triggers a run
 *   R8.7  scheduler updates `lastStatus` to the run's final status via the
 *         `run-finished` listener
 *
 * (R8.1 — ScheduleForm default silent=false — is covered by the client test
 *  hub/client/src/components/schedule-form/ScheduleForm.silent.test.tsx.)
 *
 * Strategy: mock `node:child_process` so `runner` spawns a controllable
 * EventEmitter "child" instead of a real OS process (emit `close` to drive the
 * terminal transition), and mock `node-cron` so the scheduler's tick callback
 * can be invoked deterministically. The Local_DB is forced to `:memory:` so the
 * real runtime DB on disk is never touched.
 */

// -- Hoisted shared state -----------------------------------------------------
// Runs before any import is evaluated, so config.ts picks up the in-memory DB
// and the child-process / cron mocks are installed before runner/scheduler
// construct their singletons.
const reg = vi.hoisted(() => {
  process.env.HUB_DB_PATH = ':memory:';
  return {
    /** Every fake child created via the mocked spawn(), in creation order. */
    children: [] as Array<{
      cmd: string;
      pid: number;
      emit: (event: string, ...args: unknown[]) => boolean;
    }>,
    pid: 1000,
  };
});

const cronReg = vi.hoisted(() => ({
  /** Captured cron tick callbacks, in registration order. */
  callbacks: [] as Array<() => void | Promise<void>>,
}));

// The scheduler builds the run command via the (async, manifest-loading)
// command-builder before calling runner.start(). Stub it so the tick resolves
// deterministically without touching the real manifest registry.
vi.mock('../command-builder.js', () => ({
  buildTaskCommand: vi.fn(async () => 'task pw:run-local PROJECT=demo'),
}));

// The cron tick gates on getEnabledToolIds() (a scan of the git-ignored,
// CI-absent tool repos); treat the scheduled tool as enabled so the trigger /
// lifecycle is exercised here rather than the tick bailing on an empty set.
vi.mock('../manifest-registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../manifest-registry.js')>();
  return { ...actual, getEnabledToolIds: vi.fn(async () => new Set(['playwright'])) };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const { EventEmitter } = await import('node:events');

  class FakeChild extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    pid: number;
    cmd: string;
    constructor(cmd: string) {
      super();
      this.cmd = cmd;
      this.pid = ++reg.pid;
    }
    kill(): boolean {
      return true;
    }
  }

  function spawn(cmd: string): import('node:child_process').ChildProcess {
    const child = new FakeChild(cmd);
    reg.children.push(child);
    // `killProcessTree` spawns `taskkill` on Windows and awaits its `close`.
    // Auto-settle it so the cancel path never dangles in tests.
    if (cmd === 'taskkill') {
      setImmediate(() => child.emit('close', 0, null));
    }
    return child as unknown as import('node:child_process').ChildProcess;
  }

  return { ...actual, spawn };
});

vi.mock('node-cron', () => ({
  default: {
    schedule: (_expr: string, fn: () => void | Promise<void>) => {
      cronReg.callbacks.push(fn);
      return { stop: () => {}, start: () => {} };
    },
    validate: () => true,
  },
}));

// Imported AFTER the mocks above are registered.
const { runner } = await import('../runner.js');
const { scheduler } = await import('../scheduler.js');

/** The most recent fake child that is an actual run (not a `taskkill` helper). */
function latestRunChild() {
  for (let i = reg.children.length - 1; i >= 0; i--) {
    const c = reg.children[i];
    if (c && c.cmd !== 'taskkill') return c;
  }
  throw new Error('no run child spawned');
}

function makeConfig(overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    tool: 'playwright',
    type: 'e2e',
    project: 'demo',
    mode: 'local',
    ...overrides,
  };
}

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

beforeEach(() => {
  reg.children.length = 0;
  cronReg.callbacks.length = 0;
});

describe('runner.cancel on an active run (R7.3)', () => {
  it('marks the run cancelled and removes it from the active list', () => {
    const record = runner.start(makeConfig(), 'task pw:run-local PROJECT=demo');
    const id = record.id;

    // R7.1: the run is in the active list right after start.
    expect(runner.getActive().some((r) => r.id === id)).toBe(true);

    const child = latestRunChild();

    let finalStatus: string | undefined;
    // Add (and later remove) only THIS listener so the scheduler's own
    // `run-finished` listener — attached at construction — is preserved for
    // the scheduler tests below.
    const onEvent = (e: WsServerEvent) => {
      if (e.kind === 'run-finished' && e.runId === id) finalStatus = e.record.status;
    };
    runner.on('event', onEvent);

    try {
      // R7.3: cancel an active run → returns true (the route then 200s).
      expect(runner.cancel(id)).toBe(true);

      // Simulate the OS reporting the kill the way Windows `taskkill /F` does:
      // a non-zero exit code with no signal. The cancel intent must still win.
      child.emit('close', 1, null);

      // R7.3: terminal status is 'cancelled' regardless of the raw exit code...
      expect(finalStatus).toBe('cancelled');
      // ...and the run has left the active list.
      expect(runner.getActive().some((r) => r.id === id)).toBe(false);
    } finally {
      runner.off('event', onEvent);
    }
  });
});

describe('scheduler trigger + silent run lifecycle (R8.5, R8.6, R8.7)', () => {
  it('stamps lastRunAt/pending on trigger then the final status, with no trace for a silent run', async () => {
    const before = new Date().toISOString();
    const schedule = scheduler.create('nightly-silent', '0 8 * * *', makeConfig({ silent: true }));

    // The scheduler registered exactly one cron tick callback for this schedule.
    expect(cronReg.callbacks.length).toBe(1);

    const historyBefore = runner.getHistory().length;

    // Fire the cron tick deterministically (no real timer). The tick is async
    // (it builds the run command before starting), so await it.
    const tick = cronReg.callbacks[0];
    if (!tick) throw new Error('cron tick callback was not registered');
    await tick();

    // R8.6: trigger stamps an ISO-8601 lastRunAt and lastStatus = 'pending'.
    const triggered = scheduler.get(schedule.id);
    expect(triggered?.lastStatus).toBe('pending');
    expect(triggered?.lastRunAt).toMatch(ISO_8601);
    expect(triggered?.lastRunAt && triggered.lastRunAt >= before).toBe(true);

    const runId = triggered?.lastRunId;
    expect(typeof runId).toBe('string');

    // The triggered run is silent and currently active (R7.1).
    expect(runner.getActive().some((r) => r.id === runId)).toBe(true);

    // Finish the run successfully (exit code 0).
    const child = latestRunChild();
    child.emit('close', 0, null);

    // R8.7: lastStatus is updated to the final outcome via run-finished.
    expect(scheduler.get(schedule.id)?.lastStatus).toBe('passed');

    // R8.5: a silent run leaves NO trace — history did not grow and the
    // output buffer for the run id is gone.
    expect(runner.getHistory().length).toBe(historyBefore);
    expect(runner.getOutputBuffer(runId as string)).toBeNull();

    scheduler.delete(schedule.id);
  });

  it('records a failed final status for a non-zero exit (R8.7)', async () => {
    const schedule = scheduler.create('nightly-loud', '0 9 * * *', makeConfig({ silent: false }));
    const tick = cronReg.callbacks[0];
    if (!tick) throw new Error('cron tick callback was not registered');
    await tick();

    expect(scheduler.get(schedule.id)?.lastStatus).toBe('pending');

    const child = latestRunChild();
    child.emit('close', 2, null);

    // R8.7: a non-zero exit maps to a 'failed' final status on the schedule.
    expect(scheduler.get(schedule.id)?.lastStatus).toBe('failed');

    scheduler.delete(schedule.id);
  });
});
