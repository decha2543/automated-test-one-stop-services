import type { RunRecord, RunRequest, RunStatus, WsServerEvent } from '@hub/shared';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Property 16 — Non-schedule runs produce no toast (R9.5).
 *
 * A run that is NOT bound to a schedule never produces a `schedule-finished`
 * event, hence the client never raises a Corner_Toast for it. The scheduler
 * only emits `schedule-finished` for runs present in its private
 * `runToSchedule` map; an unbound `run-finished` event is dropped early
 * (see `scheduler.attachListener`).
 *
 * We exercise the real emit path: the scheduler singleton attaches its
 * `run-finished` listener on construction, so importing it wires the listener
 * onto the shared runner event bus. With an in-memory Local_DB the scheduler
 * boots with zero schedules, so `runToSchedule` is empty and EVERY runId is
 * unbound. We then push arbitrary `run-finished` events (varied runId/status)
 * through the runner bus and assert no `schedule-finished` event is observed.
 */

/** The shared runner singleton, wired during beforeAll (after DB isolation). */
let runner: typeof import('../runner.js')['runner'];
/** Count of `schedule-finished` events seen on the runner bus. */
let scheduleFinishedCount = 0;

beforeAll(async () => {
  // Set the DB to an ephemeral in-memory store BEFORE the runner/scheduler
  // singletons are constructed, so neither touches the real hub.db and the
  // scheduler boots with an empty schedules list (every runId is unbound).
  const { setDb } = await import('../db.js');
  const { openLocalDb } = await import('../local-db.js');
  setDb(openLocalDb(':memory:'));

  // Importing runner wires the shared event bus; importing scheduler
  // constructs the singleton and attaches its run-finished listener.
  ({ runner } = await import('../runner.js'));
  await import('../scheduler.js');

  // Observe the same bus the scheduler re-emits `schedule-finished` on.
  runner.on('event', (event: WsServerEvent) => {
    if (event.kind === 'schedule-finished') scheduleFinishedCount += 1;
  });
});

afterAll(async () => {
  // Reset the shared DB instance so later suites re-open from config.
  const { setDb } = await import('../db.js');
  setDb(undefined);
});

/** Every terminal/intermediate run status — the scheduler ignores status entirely. */
const statusArb: fc.Arbitrary<RunStatus> = fc.constantFrom(
  'pending',
  'running',
  'passed',
  'skipped',
  'failed',
  'cancelled',
  'error',
);

/** A non-empty runId that is guaranteed NOT to be registered to any schedule. */
const runIdArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 24 });

/** Build a minimal, type-correct RunRecord for an unbound run. */
function makeUnboundRecord(runId: string, status: RunStatus): RunRecord {
  const request: RunRequest = {
    tool: 'playwright',
    type: 'web',
    project: 'demo',
    mode: 'local',
  };
  const ended =
    status === 'passed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'error' ||
    status === 'skipped';
  return {
    id: runId,
    request,
    command: 'noop',
    status,
    startedAt: new Date().toISOString(),
    ...(ended ? { endedAt: new Date().toISOString() } : {}),
  };
}

describe('scheduler: non-schedule runs produce no toast (Property 16)', () => {
  // Feature: one-stop-service-upgrade, Property 16: Non-schedule runs produce no toast
  it('never emits schedule-finished for a run-finished event with an unbound runId', () => {
    fc.assert(
      fc.property(runIdArb, statusArb, (runId, status) => {
        const before = scheduleFinishedCount;
        const record = makeUnboundRecord(runId, status);

        // Drive the unbound run-finished event through the real runner bus
        // that the scheduler subscribes to.
        runner.emit('event', { kind: 'run-finished', runId, record });

        // The scheduler drops unbound runs early, so no schedule-finished
        // event (and therefore no Corner_Toast) is ever produced (R9.5).
        expect(scheduleFinishedCount).toBe(before);
      }),
      { numRuns: 200 },
    );
  });

  // Concrete example: a typical user-initiated (non-schedule) passed run.
  // Feature: one-stop-service-upgrade, Property 16: Non-schedule runs produce no toast
  it('an ad-hoc passed run produces zero schedule-finished events (example)', () => {
    const before = scheduleFinishedCount;
    runner.emit('event', {
      kind: 'run-finished',
      runId: 'adhoc-user-run',
      record: makeUnboundRecord('adhoc-user-run', 'passed'),
    });
    expect(scheduleFinishedCount).toBe(before);
  });
});
