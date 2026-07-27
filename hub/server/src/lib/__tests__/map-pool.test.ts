import { describe, expect, it } from 'vitest';
import { mapPool } from '../map-pool.js';

describe('mapPool', () => {
  it('returns results in input order regardless of completion order', async () => {
    const out = await mapPool([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual([30, 10, 20]);
  });

  it('never exceeds the concurrency cap', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapPool([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('handles an empty input without spawning a worker', async () => {
    let calls = 0;
    const out = await mapPool<number, number>([], 4, async (n) => {
      calls++;
      return n;
    });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });
});
