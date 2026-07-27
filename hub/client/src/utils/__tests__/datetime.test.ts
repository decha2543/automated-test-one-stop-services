import { describe, expect, it } from 'vitest';
import { formatDurationBetween, formatDurationMs } from '~/utils/datetime.js';

describe('formatDurationMs', () => {
  it('renders sub-minute spans in seconds', () => {
    expect(formatDurationMs(0)).toBe('0s');
    expect(formatDurationMs(45_000)).toBe('45s');
    expect(formatDurationMs(59_999)).toBe('59s');
  });

  it('renders minute spans with the remaining seconds', () => {
    expect(formatDurationMs(60_000)).toBe('1m 0s');
    expect(formatDurationMs(192_000)).toBe('3m 12s');
  });

  it('renders hour spans with the remaining minutes', () => {
    expect(formatDurationMs(3_600_000)).toBe('1h 0m');
    expect(formatDurationMs(7_500_000)).toBe('2h 5m');
  });

  it('renders a placeholder for unusable input', () => {
    expect(formatDurationMs(-1)).toBe('-');
    expect(formatDurationMs(Number.NaN)).toBe('-');
  });
});

describe('formatDurationBetween', () => {
  it('formats the span between two ISO timestamps', () => {
    expect(formatDurationBetween('2026-07-27T10:00:00.000Z', '2026-07-27T10:03:12.000Z')).toBe(
      '3m 12s',
    );
  });

  it('renders a placeholder while a run is still going', () => {
    expect(formatDurationBetween('2026-07-27T10:00:00.000Z')).toBe('-');
  });

  it('renders a placeholder for an unparseable timestamp', () => {
    expect(formatDurationBetween('not-a-date', '2026-07-27T10:00:00.000Z')).toBe('-');
  });
});
