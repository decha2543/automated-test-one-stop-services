import { describe, expect, it } from 'vitest';
import { buildRunFlags, mergeExtraArgs, parseRunArgs } from '~/utils/run-flags.js';

describe('buildRunFlags', () => {
  it('renders each typed option', () => {
    expect(buildRunFlags({ workers: 4, repeatEach: 3 })).toBe('--workers=4 --repeat-each=3');
  });

  it('is empty when nothing is set, so callers can concatenate blindly', () => {
    expect(buildRunFlags({})).toBe('');
    expect(buildRunFlags({ workers: null, repeatEach: null })).toBe('');
  });

  it('ignores values below 1 and truncates fractions', () => {
    expect(buildRunFlags({ workers: 0 })).toBe('');
    expect(buildRunFlags({ workers: -2 })).toBe('');
    expect(buildRunFlags({ repeatEach: 2.7 })).toBe('--repeat-each=2');
  });
});

describe('mergeExtraArgs', () => {
  it('keeps unrelated free-text arguments and appends the typed flags', () => {
    expect(mergeExtraArgs('--headed --debug', { workers: 2 })).toBe('--headed --debug --workers=2');
  });

  it('lets the typed field win over the same flag hand-typed in free text', () => {
    expect(mergeExtraArgs('--workers=8 --headed', { workers: 2 })).toBe('--headed --workers=2');
    expect(mergeExtraArgs('--workers 8', { workers: 2 })).toBe('--workers=2');
  });

  it('leaves hand-typed flags alone when the typed field is empty', () => {
    expect(mergeExtraArgs('--workers=8', {})).toBe('--workers=8');
  });

  it('returns undefined when there is nothing to pass', () => {
    expect(mergeExtraArgs('', {})).toBeUndefined();
    expect(mergeExtraArgs(undefined, {})).toBeUndefined();
    expect(mergeExtraArgs('   ', { workers: null })).toBeUndefined();
  });
});

describe('parseRunArgs', () => {
  it('lifts the typed options back out and keeps the rest', () => {
    expect(parseRunArgs('--headed --workers=4 --repeat-each=3')).toEqual({
      workers: 4,
      repeatEach: 3,
      rest: '--headed',
    });
  });

  it('accepts the space-separated flag form', () => {
    expect(parseRunArgs('--workers 2').workers).toBe(2);
  });

  it('returns nulls and an empty rest for no arguments', () => {
    expect(parseRunArgs(undefined)).toEqual({ workers: null, repeatEach: null, rest: '' });
  });

  it('leaves the caller’s own flags untouched', () => {
    expect(parseRunArgs('--debug --grep=x').rest).toBe('--debug --grep=x');
  });

  it('round-trips with mergeExtraArgs', () => {
    const options = { workers: 4, repeatEach: 2 };
    const merged = mergeExtraArgs('--headed', options);
    const parsed = parseRunArgs(merged);
    expect(parsed).toEqual({ ...options, rest: '--headed' });
  });
});
