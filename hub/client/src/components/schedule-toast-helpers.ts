import type { WsServerEvent } from '@hub/shared';

/**
 * The `schedule-finished` variant of {@link WsServerEvent}. Extracted as a
 * standalone type so the pure helpers below operate on exactly the payload
 * the WS listener (task 7.3) hands them.
 */
export type ScheduleFinishedEvent = Extract<WsServerEvent, { kind: 'schedule-finished' }>;

/** Toast variant derived from the run's final status. */
export type ScheduleToastType = 'success' | 'error';

/**
 * Pure descriptor returned by {@link buildScheduleToast}. The WS listener maps
 * this onto Mantine `notifications.show(...)`; keeping it as a plain object lets
 * us property-test the decision logic without touching the DOM.
 */
export interface ScheduleToastDescriptor {
  /** Toast id tied to the runId so concurrent completions render as distinct toasts (R9.6). */
  id: string;
  /** High-level variant. */
  type: ScheduleToastType;
  /** Mantine color mapped from {@link type}. */
  color: 'green' | 'red';
  title: string;
  /** Includes the schedule name (or id) and the final status; failure reason when present. */
  message: string;
  /** Auto-close duration in ms (success 5000, failure 10000). */
  autoClose: number;
}

/** Minimal slice of preferences the toast gate needs (per-scheduleId enable map). */
export interface ScheduleToastPreferences {
  /**
   * Per-scheduleId switch for silent-schedule toasts. A missing entry means
   * enabled (R10.6 default-enabled). A `false` entry suppresses the toast (R10.5).
   */
  silentScheduleToast: Record<string, boolean>;
}

const SUCCESS_AUTO_CLOSE_MS = 5000;
const FAILURE_AUTO_CLOSE_MS = 10000;

/** Stable toast id bound to the runId so distinct runs never overwrite each other (R9.6). */
export function scheduleToastId(runId: string): string {
  return `schedule-${runId}`;
}

/**
 * Pure mapping from a `schedule-finished` event to a toast descriptor.
 *
 * - `passed` → success toast, auto-close 5000ms (R9.1, R9.3, R10.1)
 * - any other terminal status (`failed`, `cancelled`, `error`, ...) → error toast,
 *   auto-close 10000ms (R9.2, R9.4, R10.2)
 *
 * The message always names the schedule (or its id when unnamed) and the final
 * status; for failures the event `message` (failure reason) is appended (R10.2).
 * The toast id is bound to the runId so concurrent completions stay distinct (R9.6).
 */
export function buildScheduleToast(event: ScheduleFinishedEvent): ScheduleToastDescriptor {
  const isSuccess = event.status === 'passed';
  const name = event.scheduleName;

  if (isSuccess) {
    return {
      id: scheduleToastId(event.runId),
      type: 'success',
      color: 'green',
      title: 'Schedule completed',
      message: `${name} — ${event.status}`,
      autoClose: SUCCESS_AUTO_CLOSE_MS,
    };
  }

  const reason = event.message?.trim();
  const message = reason ? `${name} — ${event.status}: ${reason}` : `${name} — ${event.status}`;

  return {
    id: scheduleToastId(event.runId),
    type: 'error',
    color: 'red',
    title: 'Schedule failed',
    message,
    autoClose: FAILURE_AUTO_CLOSE_MS,
  };
}

/**
 * Pure predicate deciding whether a `schedule-finished` event should surface a
 * Corner_Toast given the user's preferences.
 *
 * - Non-silent schedules always show a toast.
 * - Silent schedules show a toast unless the user disabled the per-scheduleId
 *   `silentScheduleToast` preference (R10.5). Missing entry = enabled (R10.6).
 */
export function shouldShowScheduleToast(
  event: ScheduleFinishedEvent,
  prefs: ScheduleToastPreferences,
): boolean {
  if (!event.silent) {
    return true;
  }
  return prefs.silentScheduleToast[event.scheduleId] ?? true;
}
