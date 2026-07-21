import type { EventEmitter } from 'node:events';
import type { RunRequest } from '@hub/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Cancel fallback-finalize (Windows orphaned-worker case).
 *
 * On Windows + Git Bash the real workers (task → node → browser) are reparented
 * away from the tracked `bash -c` pid, so `taskkill /T /F` reaps only the shell
 * layer and the orphaned workers keep the child's stdio pipes open. Node then
 * never emits `close`, so before this fix the run stuck on `running` forever
 * and the UI "Stop" did nothing.
 *
 * This models that exact condition: a run is cancelled but its fake child never
 * emits `close`. After the grace window the runner must force-finalize the run
 * so it leaves the active list. The converse (close fires first) must NOT be
 * double-finalized by the fallback.
 */

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid: number;
  kill: () => boolean;
}

const { spawnedChildren } = vi.hoisted(() => {
  process.env.HUB_DB_PATH = ':memory:';
  return { spawnedChildren: [] as FakeChild[] };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const { EventEmitter } = await import('node:events');
  return {
    ...actual,
    spawn: (..._args: unknown[]) => {
      const child = new EventEmitter() as FakeChild;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.pid = 10_000 + spawnedChildren.length;
      child.kill = () => true;
      spawnedChildren.push(child);
      return child;
    },
  };
});

import { runner } from '../runner.js';

const CANCEL_FINALIZE_GRACE_MS = 5000;
const silentReq: RunRequest = {
  tool: 'playwright',
  type: 'web',
  project: 'p',
  mode: 'local',
  silent: true,
} as RunRequest;

const isActive = (id: string): boolean => runner.getActive().some((r) => r.id === id);

describe('runner.cancel fallback-finalize', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    runner.setMaxConcurrency(100);
    spawnedChildren.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('force-finalizes a cancelled run whose child close never fires, after the grace window', () => {
    const record = runner.start(silentReq, 'task test:run');
    expect(isActive(record.id)).toBe(true);

    // Cancel — but the child never emits `close` (orphaned workers hold stdio).
    expect(runner.cancel(record.id)).toBe(true);

    // Still active right up to the grace boundary...
    vi.advanceTimersByTime(CANCEL_FINALIZE_GRACE_MS - 1);
    expect(isActive(record.id)).toBe(true);

    // ...then the fallback fires and removes it from the active list.
    vi.advanceTimersByTime(1);
    expect(isActive(record.id)).toBe(false);
  });

  it('does not double-finalize when close fires before the grace window', () => {
    const record = runner.start(silentReq, 'task test:run');
    const child = spawnedChildren[0] as FakeChild;

    let finishedCount = 0;
    runner.on('event', (e: { kind: string; runId?: string }) => {
      if (e.kind === 'run-finished' && e.runId === record.id) finishedCount += 1;
    });

    expect(runner.cancel(record.id)).toBe(true);
    // Close fires promptly (clean kill) — run leaves active immediately.
    child.emit('close', null, 'SIGINT');
    expect(isActive(record.id)).toBe(false);

    // Advancing past the grace window must NOT finalize a second time.
    vi.advanceTimersByTime(CANCEL_FINALIZE_GRACE_MS + 10);
    expect(finishedCount).toBe(1);
    expect(isActive(record.id)).toBe(false);
  });
});
