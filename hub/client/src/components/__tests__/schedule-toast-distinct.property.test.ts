// Feature: one-stop-service-upgrade, Property 17: Concurrent schedule toasts are distinct
import type { RunStatus } from '@hub/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
    buildScheduleToast,
    type ScheduleFinishedEvent,
    scheduleToastId,
} from '../schedule-toast-helpers';

/**
 * Property test for Task 7.6 — Concurrent schedule toasts are distinct.
 *
 * Validates: Requirements 9.6
 *
 * When 2+ schedule-bound runs complete simultaneously, their toasts must be
 * distinct and never overwrite each other. The toast id is a pure function of
 * `runId`, so:
 *   - distinct runIds yield distinct toast ids (pairwise distinct), and
 *   - the same runId always yields the same toast id (deterministic).
 *
 * Building toasts for a batch of `schedule-finished` events with distinct
 * runIds therefore produces a set of toast ids whose size equals the batch
 * size — no collisions, no overwrites.
 */

const RUN_STATUSES: readonly RunStatus[] = [
  'pending',
  'running',
  'passed',
  'skipped',
  'failed',
  'cancelled',
  'error',
] as const;

/**
 * Smart generator for a `schedule-finished` event whose `runId` is supplied by
 * the caller. The remaining fields (scheduleId/name/status/silent/message) vary
 * freely because Property 17 must hold regardless of their values — the toast
 * id depends on `runId` alone.
 */
function eventArbForRunId(runId: string): fc.Arbitrary<ScheduleFinishedEvent> {
  return fc.record(
    {
      kind: fc.constant('schedule-finished' as const),
      runId: fc.constant(runId),
      scheduleId: fc.string({ minLength: 1, maxLength: 16 }),
      scheduleName: fc.string({ minLength: 1, maxLength: 24 }),
      status: fc.constantFrom(...RUN_STATUSES),
      silent: fc.boolean(),
      message: fc.option(fc.string({ maxLength: 32 }), { nil: undefined }),
    },
    { requiredKeys: ['kind', 'runId', 'scheduleId', 'scheduleName', 'status', 'silent'] },
  );
}

/**
 * A batch of `schedule-finished` events whose runIds are pairwise distinct,
 * modelling 2+ concurrent completions. We first draw a set of unique runIds,
 * then attach a freely-varying event payload to each.
 */
const distinctRunIdsArb: fc.Arbitrary<string[]> = fc.uniqueArray(
  fc.string({ minLength: 1, maxLength: 20 }),
  { minLength: 2, maxLength: 30 },
);

const distinctEventsArb: fc.Arbitrary<ScheduleFinishedEvent[]> = distinctRunIdsArb.chain((runIds) =>
  fc.tuple(...runIds.map((runId) => eventArbForRunId(runId))),
);

describe('Property 17: Concurrent schedule toasts are distinct', () => {
  it('produces pairwise-distinct toast ids for a batch of events with distinct runIds', () => {
    fc.assert(
      fc.property(distinctEventsArb, (events) => {
        const ids = events.map((event) => buildScheduleToast(event).id);

        // No two concurrent toasts share an id, so none overwrites another.
        expect(new Set(ids).size).toBe(ids.length);
      }),
      { numRuns: 100 },
    );
  });

  it('maps distinct runIds to distinct toast ids (scheduleToastId is injective)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 24 }),
        fc.string({ minLength: 1, maxLength: 24 }),
        (a, b) => {
          fc.pre(a !== b);
          expect(scheduleToastId(a)).not.toBe(scheduleToastId(b));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('maps the same runId to the same toast id (scheduleToastId is deterministic)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 24 }), (runId) => {
        expect(scheduleToastId(runId)).toBe(scheduleToastId(runId));
        // And buildScheduleToast agrees with scheduleToastId for that runId.
        const events = fc.sample(eventArbForRunId(runId), 1);
        const toast = buildScheduleToast(events[0] as ScheduleFinishedEvent);
        expect(toast.id).toBe(scheduleToastId(runId));
      }),
      { numRuns: 100 },
    );
  });
});
