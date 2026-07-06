// Feature: one-stop-service-upgrade, Property 18: Schedule toasts never persist
import type { RunStatus } from '@hub/shared';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNotifications } from '../../stores/hub';
import {
    buildScheduleToast,
    type ScheduleFinishedEvent,
    type ScheduleToastDescriptor,
    type ScheduleToastPreferences,
    shouldShowScheduleToast,
} from '../schedule-toast-helpers';

/**
 * Every status a `schedule-finished` event can carry. Drawing from the full
 * {@link RunStatus} union (not just the terminal subset) keeps the generator
 * honest: the no-persistence contract must hold for any status value.
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
 * Smart generator constrained to the real {@link ScheduleFinishedEvent} shape:
 * the discriminant is fixed, ids/name are non-empty strings, status is drawn
 * from the valid union, and `message` is optionally present (failure reason).
 */
const scheduleEventArb: fc.Arbitrary<ScheduleFinishedEvent> = fc.record(
  {
    kind: fc.constant('schedule-finished' as const),
    runId: fc.string({ minLength: 1, maxLength: 24 }),
    scheduleId: fc.string({ minLength: 1, maxLength: 24 }),
    scheduleName: fc.string({ minLength: 1, maxLength: 32 }),
    status: fc.constantFrom(...RUN_STATUSES),
    silent: fc.boolean(),
    message: fc.option(fc.string({ maxLength: 48 }), { nil: undefined }),
  },
  { requiredKeys: ['kind', 'runId', 'scheduleId', 'scheduleName', 'status', 'silent'] },
);

/**
 * Generator for the toast-gate preferences. Sometimes keys the disable-map by
 * the event's own scheduleId so the silent-suppression branch is exercised too,
 * and sometimes uses unrelated keys — none of which may touch the store.
 */
function prefsArbFor(event: ScheduleFinishedEvent): fc.Arbitrary<ScheduleToastPreferences> {
  return fc.record({
    silentScheduleToast: fc.oneof(
      fc.constant<Record<string, boolean>>({}),
      fc.constant<Record<string, boolean>>({ [event.scheduleId]: false }),
      fc.constant<Record<string, boolean>>({ [event.scheduleId]: true }),
      fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.boolean(), { maxKeys: 4 }),
    ),
  });
}

/** The exact key set of an ephemeral {@link ScheduleToastDescriptor}. */
const DESCRIPTOR_KEYS: ReadonlyArray<keyof ScheduleToastDescriptor> = [
  'id',
  'type',
  'color',
  'title',
  'message',
  'autoClose',
];

/**
 * Keys that only exist on a *persisted* `HubNotification` record (the shape the
 * `useNotifications` store stores). An ephemeral toast descriptor must carry
 * none of them, proving the pipeline did not produce a persisted record.
 */
const PERSISTENCE_MARKER_KEYS = ['timestamp', 'read', 'unreadCount'] as const;

describe('Property 18: Schedule toasts never persist', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('building/deciding a schedule toast never writes to the persistent notifications store', () => {
    // Snapshot the persistent store BEFORE touching the pure pipeline. We never
    // mutate it here (mutating actions would trigger the persist middleware), so
    // any change observed after running the helpers would be a real violation.
    const before = useNotifications.getState();
    const beforeNotificationsRef = before.notifications;
    const beforeLength = before.notifications.length;
    const beforeUnread = before.unreadCount;

    // Spy on every mutator of the persistent store. The pure toast pipeline
    // must never invoke any of them. Spying does not trigger persistence.
    const addSpy = vi.spyOn(before, 'add');
    const markReadSpy = vi.spyOn(before, 'markRead');
    const markAllReadSpy = vi.spyOn(before, 'markAllRead');
    const clearSpy = vi.spyOn(before, 'clear');

    fc.assert(
      fc.property(scheduleEventArb, fc.boolean(), (event, withGate) => {
        // Run the full pure pipeline: optionally gate, then build.
        if (withGate) {
          const prefs = fc.sample(prefsArbFor(event), 1)[0] as ScheduleToastPreferences;
          shouldShowScheduleToast(event, prefs);
        }
        const descriptor = buildScheduleToast(event);

        // 1. The returned descriptor is a plain ephemeral object: it has exactly
        //    the descriptor keys and NONE of the persisted-record markers.
        expect(Object.keys(descriptor).sort()).toEqual([...DESCRIPTOR_KEYS].sort());
        for (const key of PERSISTENCE_MARKER_KEYS) {
          expect(Object.hasOwn(descriptor, key)).toBe(false);
        }

        // 2. The persistent notifications collection is byte-for-byte unchanged
        //    (same reference, same length, same unread count) — proving the
        //    helpers produced no persisted record.
        const state = useNotifications.getState();
        expect(state.notifications).toBe(beforeNotificationsRef);
        expect(state.notifications.length).toBe(beforeLength);
        expect(state.unreadCount).toBe(beforeUnread);
      }),
      { numRuns: 200 },
    );

    // 3. No persistence action was ever invoked across all runs. Because
    //    `useNotifications` is the localStorage-backed (zustand persist) store,
    //    proving no mutator fired also proves nothing was written to
    //    localStorage or surfaced in the NotificationCenter history (R10.4).
    expect(addSpy).not.toHaveBeenCalled();
    expect(markReadSpy).not.toHaveBeenCalled();
    expect(markAllReadSpy).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('never references the run id from the persistent store, regardless of event', () => {
    // Independent angle on the same contract: after running the pure pipeline
    // for any event, no persisted notification references the run — the store
    // collection stays empty of this run's id.
    fc.assert(
      fc.property(scheduleEventArb, (event) => {
        buildScheduleToast(event);
        shouldShowScheduleToast(event, { silentScheduleToast: {} });

        const { notifications } = useNotifications.getState();
        expect(notifications.some((n) => n.id === event.runId)).toBe(false);
        expect(notifications.some((n) => n.message.includes(event.runId))).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
