import { describe, expect, it } from 'vitest';
import {
    buildScheduleToast,
    type ScheduleFinishedEvent,
    scheduleToastId,
    shouldShowScheduleToast,
} from '../schedule-toast-helpers';

function event(overrides: Partial<ScheduleFinishedEvent> = {}): ScheduleFinishedEvent {
  return {
    kind: 'schedule-finished',
    runId: 'run-1',
    scheduleId: 'sched-1',
    scheduleName: 'Nightly smoke',
    status: 'passed',
    silent: false,
    ...overrides,
  };
}

describe('buildScheduleToast', () => {
  it('builds a success toast with 5000ms auto-close for passed runs', () => {
    const toast = buildScheduleToast(event({ status: 'passed' }));
    expect(toast.type).toBe('success');
    expect(toast.color).toBe('green');
    expect(toast.autoClose).toBe(5000);
    expect(toast.message).toContain('Nightly smoke');
    expect(toast.message).toContain('passed');
    expect(toast.id).toBe(scheduleToastId('run-1'));
  });

  it('builds an error toast with 10000ms auto-close for failed runs', () => {
    const toast = buildScheduleToast(event({ status: 'failed' }));
    expect(toast.type).toBe('error');
    expect(toast.color).toBe('red');
    expect(toast.autoClose).toBe(10000);
    expect(toast.message).toContain('failed');
  });

  it('builds an error toast for cancelled runs', () => {
    const toast = buildScheduleToast(event({ status: 'cancelled' }));
    expect(toast.type).toBe('error');
    expect(toast.autoClose).toBe(10000);
    expect(toast.message).toContain('cancelled');
  });

  it('appends the failure reason for failed runs when present', () => {
    const toast = buildScheduleToast(event({ status: 'failed', message: 'exit code 1' }));
    expect(toast.message).toContain('exit code 1');
  });

  it('falls back to the schedule id as the displayed name when name equals id', () => {
    const toast = buildScheduleToast(event({ scheduleName: 'sched-1', scheduleId: 'sched-1' }));
    expect(toast.message).toContain('sched-1');
  });

  it('binds the toast id to the runId so concurrent completions stay distinct', () => {
    const a = buildScheduleToast(event({ runId: 'run-a' }));
    const b = buildScheduleToast(event({ runId: 'run-b' }));
    expect(a.id).not.toBe(b.id);
  });
});

describe('shouldShowScheduleToast', () => {
  it('always shows for non-silent schedules', () => {
    expect(shouldShowScheduleToast(event({ silent: false }), { silentScheduleToast: {} })).toBe(
      true,
    );
  });

  it('shows for silent schedules by default (no preference set)', () => {
    expect(shouldShowScheduleToast(event({ silent: true }), { silentScheduleToast: {} })).toBe(
      true,
    );
  });

  it('suppresses silent schedule toast when the preference is disabled', () => {
    const prefs = { silentScheduleToast: { 'sched-1': false } };
    expect(shouldShowScheduleToast(event({ silent: true, status: 'passed' }), prefs)).toBe(false);
    expect(shouldShowScheduleToast(event({ silent: true, status: 'failed' }), prefs)).toBe(false);
  });

  it('still shows non-silent schedule toast even when a disabled preference exists', () => {
    const prefs = { silentScheduleToast: { 'sched-1': false } };
    expect(shouldShowScheduleToast(event({ silent: false }), prefs)).toBe(true);
  });
});
