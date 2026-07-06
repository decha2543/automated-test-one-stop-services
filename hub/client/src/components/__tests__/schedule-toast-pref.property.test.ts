import type { RunStatus } from '@hub/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
    type ScheduleFinishedEvent,
    type ScheduleToastPreferences,
    shouldShowScheduleToast,
} from '../schedule-toast-helpers';

/**
 * Property test for Task 7.8 — disabled silent-schedule preference suppresses toast.
 *
 * Validates: Requirements 10.5
 */

/** Every terminal/intermediate status a `schedule-finished` event may carry. */
const statusArb: fc.Arbitrary<RunStatus> = fc.constantFrom(
  'pending',
  'running',
  'passed',
  'skipped',
  'failed',
  'cancelled',
  'error',
);

/**
 * Smart generator for a {@link ScheduleFinishedEvent}. The `scheduleId` is drawn
 * from a small pool so the arbitrary `prefs` map below has a realistic chance of
 * containing (or omitting) an entry for the event's own id — exercising both the
 * "entry present" and "missing entry = default enabled" branches.
 */
const scheduleIdArb: fc.Arbitrary<string> = fc.constantFrom(
  'sched-1',
  'sched-2',
  'sched-3',
  'sched-4',
);

const eventArb: fc.Arbitrary<ScheduleFinishedEvent> = fc.record({
  kind: fc.constant('schedule-finished' as const),
  runId: fc.string(),
  scheduleId: scheduleIdArb,
  scheduleName: fc.string(),
  status: statusArb,
  silent: fc.boolean(),
  message: fc.option(fc.string(), { nil: undefined }),
});

/**
 * Arbitrary preferences map keyed by the same scheduleId pool, with boolean
 * values, and a chance of being empty (missing entries) so the default-enabled
 * path (R10.6) is covered alongside explicit `true`/`false` entries (R10.5).
 */
const prefsArb: fc.Arbitrary<ScheduleToastPreferences> = fc
  .dictionary(scheduleIdArb, fc.boolean())
  .map((silentScheduleToast) => ({ silentScheduleToast }));

describe('shouldShowScheduleToast — disabled silent-schedule preference', () => {
  it('suppresses silent toasts only when the per-scheduleId preference is false; non-silent always shows; default enabled', () => {
    // Feature: one-stop-service-upgrade, Property 19: Disabled silent-schedule preference suppresses toast
    fc.assert(
      fc.property(eventArb, prefsArb, (event, prefs) => {
        const result = shouldShowScheduleToast(event, prefs);
        const entry = prefs.silentScheduleToast[event.scheduleId];

        if (!event.silent) {
          // Non-silent schedules always show, regardless of any preference
          // entry (even an explicit `false`) for that scheduleId.
          expect(result).toBe(true);
          return;
        }

        if (entry === false) {
          // Silent + explicitly disabled => suppressed for ALL statuses (R10.5).
          expect(result).toBe(false);
        } else {
          // Silent + (missing entry OR explicit `true`) => shown, the
          // default-enabled behaviour (R10.6).
          expect(result).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('suppresses a disabled silent schedule across every possible status', () => {
    // Feature: one-stop-service-upgrade, Property 19: Disabled silent-schedule preference suppresses toast
    const prefs: ScheduleToastPreferences = { silentScheduleToast: { 'sched-1': false } };
    fc.assert(
      fc.property(statusArb, (status) => {
        const event: ScheduleFinishedEvent = {
          kind: 'schedule-finished',
          runId: 'run-x',
          scheduleId: 'sched-1',
          scheduleName: 'Nightly',
          status,
          silent: true,
        };
        expect(shouldShowScheduleToast(event, prefs)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
