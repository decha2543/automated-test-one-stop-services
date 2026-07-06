import { describe, expect, it } from 'vitest';

import { parseEnv } from '../env-parser.js';

/** Parse a single-entry source and return its first entry, asserting it exists. */
function firstEntry(input: string) {
  const [entry] = parseEnv(input);
  if (!entry) throw new Error(`parseEnv produced no entry for: ${input}`);
  return entry;
}

describe('parseEnv — inline comments', () => {
  it('strips an inline comment off a quoted value and keeps the value empty', () => {
    const entry = firstEntry('WORKERS=""          # default 2 local / 4 CI');
    expect(entry.value).toBe('');
    expect(entry.comment).toBe('default 2 local / 4 CI');
  });

  it('strips an inline comment off an unquoted value', () => {
    const entry = firstEntry('PW_CHANNEL=chrome # use chrome');
    expect(entry.value).toBe('chrome');
    expect(entry.comment).toBe('use chrome');
  });

  it('preserves a # that is INSIDE a quoted value', () => {
    const entry = firstEntry('PASS="a#b"');
    expect(entry.value).toBe('a#b');
    expect(entry.comment).toBeUndefined();
  });

  it('does not treat # without leading whitespace as a comment (unquoted)', () => {
    const entry = firstEntry('HOST=host#1');
    expect(entry.value).toBe('host#1');
  });

  it('prefers a preceding-line comment over an inline one', () => {
    const entry = firstEntry('# line comment\nKEY="v" # inline');
    expect(entry.value).toBe('v');
    expect(entry.comment).toBe('line comment');
  });
});
