import type { EventEmitter } from 'node:events';
import type { RunRequest } from '@hub/shared';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

/** Minimal controllable stand-in for a spawned ChildProcess. */
interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid: number;
  kill: () => boolean;
}

/**
 * Property 12 — Silent run active-list lifecycle (R7.1, R7.2).
 *
 * For any Silent_Run: once started it appears in `getActive()` with a unique
 * run identifier (while running, R7.1), and once it reaches any terminal state
 * (passed / failed / cancelled / error) it is removed from `getActive()`
 * (R7.2). The requirement's 1s figure is an upper bound — the runner removes
 * the run synchronously inside its terminal handler, so we assert the
 * near-synchronous removal that happens the moment the child finishes rather
 * than waiting a real second.
 *
 * Strategy: we mock `node:child_process.spawn` with a controllable
 * EventEmitter-based fake child. That lets us decide deterministically when a
 * run is "running" (after start, before we fire a terminal event) versus
 * "terminal" (after we emit `close`/`error`). No real process is spawned and
 * no real 1s timers are involved, so the test is fast and runs 100+ cases.
 */

// Shared registry of fake children, plus the in-memory DB switch, set up before
// any imports evaluate (the runner singleton touches the DB at construction).
const { spawnedChildren } = vi.hoisted(() => {
  // Use an ephemeral in-memory Local_DB so the runner's constructor seeding
  // (historyStore.getAll) never touches the real hub.db file. Silent runs do
  // not write history, but this keeps the whole test hermetic regardless.
  process.env.HUB_DB_PATH = ':memory:';
  return { spawnedChildren: [] as FakeChild[] };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const { EventEmitter } = await import('node:events');
  return {
    ...actual,
    // A fake ChildProcess: stdout/stderr are EventEmitters so the runner's
    // `.on('data', ...)` wiring works; `.on('close'|'error', ...)` is provided
    // by the EventEmitter base. `pid` is set and `kill` is a no-op so the
    // (unused here) cancel path would not blow up either.
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

// Imported AFTER the mock/hoisted env is in place.
import { runner } from '../runner.js';

type Terminal = 'passed' | 'failed' | 'cancelled' | 'error';

/** Drive a fake child to a terminal state matching the runner's classifier. */
function terminate(child: FakeChild, outcome: Terminal): void {
  switch (outcome) {
    case 'passed':
      child.emit('close', 0, null);
      break;
    case 'failed':
      child.emit('close', 1, null);
      break;
    case 'cancelled':
      // A signal close is classified as `cancelled` by the runner.
      child.emit('close', null, 'SIGINT');
      break;
    case 'error':
      // A spawn-level error is also a terminal outcome (routed via finishRun).
      child.emit('error', new Error('boom'));
      break;
  }
}

const activeIds = (): string[] => runner.getActive().map((r) => r.id);

/** Silent RunRequest generator (silent is always true for Property 12). */
const silentReqArb: fc.Arbitrary<RunRequest> = fc
  .record({
    tool: fc.constantFrom('playwright', 'robot-framework', 'k6'),
    type: fc.constantFrom('web', 'api', 'desktop', 'mobile'),
    project: fc.string({ minLength: 1, maxLength: 16 }),
    mode: fc.constantFrom('local', 'docker'),
  })
  .map((r) => ({ ...r, silent: true }) as RunRequest);

const terminalArb: fc.Arbitrary<Terminal> = fc.constantFrom(
  'passed',
  'failed',
  'cancelled',
  'error',
);

describe('runner silent run active-list lifecycle (Property 12)', () => {
  // Raise concurrency so every started run spawns immediately (none queued),
  // keeping the active list and our fake-child mapping in lock-step.
  runner.setMaxConcurrency(100);

  // Feature: one-stop-service-upgrade, Property 12: Silent run active-list lifecycle
  it('a silent run is present in getActive() while running and absent after any terminal state', () => {
    fc.assert(
      fc.property(silentReqArb, terminalArb, (req, outcome) => {
        spawnedChildren.length = 0;
        const record = runner.start(req, 'task test:run');
        const child = spawnedChildren[spawnedChildren.length - 1] as FakeChild;
        try {
          // R7.1: present while running, with a unique identifier (appears once).
          const ids = activeIds();
          expect(ids).toContain(record.id);
          expect(ids.filter((id) => id === record.id)).toHaveLength(1);

          // R7.2: reaching a terminal state removes it from the active list.
          terminate(child, outcome);
          expect(activeIds()).not.toContain(record.id);
        } finally {
          // Defensive cleanup: if an assertion threw before termination, make
          // sure this run does not leak into the next iteration's active list.
          if (runner.getActive().some((r) => r.id === record.id)) {
            child.emit('close', 0, null);
          }
        }
      }),
      { numRuns: 150 },
    );
  });

  // Feature: one-stop-service-upgrade, Property 12: Silent run active-list lifecycle
  it('concurrent silent runs all appear with distinct identifiers and each is removed on terminal', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(silentReqArb, terminalArb), { minLength: 2, maxLength: 5 }),
        (scenarios) => {
          spawnedChildren.length = 0;
          const started = scenarios.map(([req]) => {
            const record = runner.start(req, 'task test:run');
            const child = spawnedChildren[spawnedChildren.length - 1] as FakeChild;
            return { record, child };
          });
          try {
            const ids = activeIds();
            // R7.1: every running silent run is present...
            for (const s of started) expect(ids).toContain(s.record.id);
            // ...with unique run identifiers across the active set.
            const startedIds = started.map((s) => s.record.id);
            expect(new Set(startedIds).size).toBe(startedIds.length);

            // R7.2: terminating each run (varying the outcome) removes exactly
            // that run from the active list.
            started.forEach((s, i) => {
              const [, outcome] = scenarios[i] as [unknown, Terminal];
              terminate(s.child, outcome);
              expect(activeIds()).not.toContain(s.record.id);
            });

            // All started runs are gone from the active list.
            const remaining = activeIds();
            for (const s of started) expect(remaining).not.toContain(s.record.id);
          } finally {
            for (const s of started) {
              if (runner.getActive().some((r) => r.id === s.record.id)) {
                s.child.emit('close', 0, null);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
