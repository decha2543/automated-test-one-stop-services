// Feature: one-stop-service-upgrade, Property 15: Schedule completion toast specification
import type { RunStatus } from '@hub/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildScheduleToast,
  type ScheduleFinishedEvent,
  scheduleToastId,
} from '../schedule-toast-helpers';

/**
 * Property test for Task 7.4 — Schedule completion toast specification.
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 10.1, 10.2
 *
 * For any `schedule-finished` event, `buildScheduleToast` produces a toast spec
 * that is consistent with the run's final status:
 *   - `passed`            → success variant (color green) with autoClose 5000ms
 *   - non-`passed`        → error variant (color red) with autoClose 10000ms
 * In every case the message names the schedule (`scheduleName`, which equals the
 * schedule id when unnamed) and the final status. Failures include the failure
 * reason (`event.message`) when present. The toast id is bound to the runId.
 */

/** Status values the toast spec must classify (task scope). */
const STATUSES: readonly RunStatus[] = ['passed', 'failed', 'cancelled', 'error'] as const;

/** Every status that must yield the error (failure) variant. */
const NON_PASSED: readonly RunStatus[] = ['failed', 'cancelled', 'error'] as const;

/**
 * Smart generator for a `schedule-finished` event. It varies the status across
 * the in-scope set, the silent flag, and an optional failure `message`. When
 * `unnamed` is drawn the `scheduleName` is set to the schedule id, exercising
 * the "id when unnamed" fallback the WS layer applies upstream.
 */
const eventArb: fc.Arbitrary<ScheduleFinishedEvent> = fc
  .record({
    runId: fc.string({ minLength: 1, maxLength: 16 }),
    scheduleId: fc.string({ minLength: 1, maxLength: 16 }),
    scheduleName: fc.string({ minLength: 1, maxLength: 24 }),
    unnamed: fc.boolean(),
    status: fc.constantFrom(...STATUSES),
    silent: fc.boolean(),
    message: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
  })
  .map(({ unnamed, scheduleId, scheduleName, ...rest }) => ({
    kind: 'schedule-finished' as const,
    scheduleId,
    scheduleName: unnamed ? scheduleId : scheduleName,
    ...rest,
  }));

/** Same generator constrained to the failure statuses with a non-empty reason. */
const failingEventWithReasonArb: fc.Arbitrary<ScheduleFinishedEvent> = fc
  .record({
    runId: fc.string({ minLength: 1, maxLength: 16 }),
    scheduleId: fc.string({ minLength: 1, maxLength: 16 }),
    scheduleName: fc.string({ minLength: 1, maxLength: 24 }),
    status: fc.constantFrom(...NON_PASSED),
    silent: fc.boolean(),
    // Reason must be non-empty after trimming so the helper appends it.
    reason: fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
  })
  .map(({ reason, ...rest }) => ({
    kind: 'schedule-finished' as const,
    ...rest,
    message: reason,
  }));

describe('Property 15: Schedule completion toast specification', () => {
  it('maps passed → success/green/5000ms and non-passed → error/red/10000ms', () => {
    fc.assert(
      fc.property(eventArb, (event) => {
        const toast = buildScheduleToast(event);

        if (event.status === 'passed') {
          expect(toast.type).toBe('success');
          expect(toast.color).toBe('green');
          expect(toast.autoClose).toBe(5000);
        } else {
          expect(toast.type).toBe('error');
          expect(toast.color).toBe('red');
          expect(toast.autoClose).toBe(10000);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('names the schedule and the final status in the message regardless of silent flag', () => {
    fc.assert(
      fc.property(eventArb, (event) => {
        const toast = buildScheduleToast(event);

        // The schedule name (which is the id when unnamed) is always present.
        expect(toast.message).toContain(event.scheduleName);
        // The final status string is always present.
        expect(toast.message).toContain(event.status);
      }),
      { numRuns: 100 },
    );
  });

  it('includes the failure reason in the message for failing runs when present', () => {
    fc.assert(
      fc.property(failingEventWithReasonArb, (event) => {
        const toast = buildScheduleToast(event);
        const reason = (event.message ?? '').trim();

        expect(toast.type).toBe('error');
        expect(toast.autoClose).toBe(10000);
        expect(toast.message).toContain(reason);
      }),
      { numRuns: 100 },
    );
  });

  it('binds the toast id to the runId', () => {
    fc.assert(
      fc.property(eventArb, (event) => {
        const toast = buildScheduleToast(event);
        expect(toast.id).toBe(scheduleToastId(event.runId));
      }),
      { numRuns: 100 },
    );
  });
});
