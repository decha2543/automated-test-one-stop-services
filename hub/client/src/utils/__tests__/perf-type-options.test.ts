import type { EnvEntry } from '@hub/shared';
import { describe, expect, it } from 'vitest';
import { buildPerfTypeData } from '../perf-type-options.js';

const entry = (key: string, value: string): EnvEntry => ({ key, value, fromTemplate: false });
const labels = (entries?: EnvEntry[]) =>
  Object.fromEntries(buildPerfTypeData(entries).map((d) => [d.value, d.label]));

describe('buildPerfTypeData', () => {
  it('annotates every profile with VU count + shape using engine defaults', () => {
    expect(labels(undefined)).toEqual({
      TEST_PROTOCOL: 'Test Protocol (5 VUs, validation)',
      MINIMAL_LOAD: 'Minimal Load (500 VUs)',
      LOAD: 'Load (1000 VUs)',
      STRESS: 'Stress (2000 VUs, 2× Load)',
      ENDURANCE: 'Endurance (1000 VUs, sustained Load)',
      PEAK: 'Peak (1000 VUs, Load spike)',
    });
  });

  it('derives counts from .env: peak scales LOAD/STRESS/ENDURANCE/PEAK, minimal scales MINIMAL_LOAD', () => {
    const byId = labels([entry('PEAK_VUS', '2000'), entry('MINIMAL_LOAD_VUS', '300')]);
    expect(byId.LOAD).toBe('Load (2000 VUs)');
    expect(byId.MINIMAL_LOAD).toBe('Minimal Load (300 VUs)');
    expect(byId.STRESS).toBe('Stress (4000 VUs, 2× Load)');
    expect(byId.ENDURANCE).toBe('Endurance (2000 VUs, sustained Load)');
    expect(byId.PEAK).toBe('Peak (2000 VUs, Load spike)');
    expect(byId.TEST_PROTOCOL).toBe('Test Protocol (5 VUs, validation)');
  });

  it('treats blank or invalid env values as "use default"', () => {
    const byId = labels([entry('PEAK_VUS', ''), entry('MINIMAL_LOAD_VUS', 'abc')]);
    expect(byId.LOAD).toBe('Load (1000 VUs)');
    expect(byId.MINIMAL_LOAD).toBe('Minimal Load (500 VUs)');
    expect(byId.STRESS).toBe('Stress (2000 VUs, 2× Load)');
  });

  it('preserves the canonical display order', () => {
    expect(buildPerfTypeData(undefined).map((d) => d.value)).toEqual([
      'TEST_PROTOCOL',
      'MINIMAL_LOAD',
      'LOAD',
      'STRESS',
      'ENDURANCE',
      'PEAK',
    ]);
  });
});
