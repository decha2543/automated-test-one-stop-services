import type { RunRecord } from '@hub/shared';
import { describe, expect, it } from 'vitest';
import { openLocalDb } from '../local-db.js';

/**
 * Regression guard for the embedded `RunRequest` boolean flags (`silent`,
 * `noTrack`) across the normalized schema. These previously had NO direct
 * round-trip coverage, which let a "silent chosen but stored false" class of
 * bug go unnoticed. We assert the three meaningful states explicitly:
 *   - `true`      → stored 1 → reads back `true`
 *   - `false`     → stored 0 → reads back `false` (NOT dropped to undefined)
 *   - `undefined` → stored NULL → reads back absent (omitted)
 */

const baseReq = {
  tool: 'playwright' as const,
  type: 'web',
  project: 'demo',
  mode: 'local' as const,
};

describe('RunRequest boolean flags round-trip (silent / noTrack)', () => {
  it('schedules: silent/noTrack true|false|undefined survive write→read', () => {
    const db = openLocalDb(':memory:');
    const schedules = [
      {
        id: 's-true',
        name: 't',
        cron: '0 0 * * *',
        config: { ...baseReq, silent: true, noTrack: true },
        enabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 's-false',
        name: 'f',
        cron: '0 0 * * *',
        config: { ...baseReq, silent: false, noTrack: false },
        enabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 's-undef',
        name: 'u',
        cron: '0 0 * * *',
        config: { ...baseReq },
        enabled: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    db.writeCollection('schedules.json', schedules);
    const back = db.readCollection<{ id: string; config: { silent?: boolean; noTrack?: boolean } }>(
      'schedules.json',
    );

    expect(back.find((s) => s.id === 's-true')?.config.silent).toBe(true);
    expect(back.find((s) => s.id === 's-true')?.config.noTrack).toBe(true);
    expect(back.find((s) => s.id === 's-false')?.config.silent).toBe(false);
    expect(back.find((s) => s.id === 's-false')?.config.noTrack).toBe(false);
    expect(back.find((s) => s.id === 's-undef')?.config.silent).toBeUndefined();
    expect(back.find((s) => s.id === 's-undef')?.config.noTrack).toBeUndefined();
  });

  it('bookmarks: silent flag survives write→read', () => {
    const db = openLocalDb(':memory:');
    db.writeCollection('bookmarks.json', [
      { id: 'b1', name: 'on', config: { ...baseReq, silent: true }, createdAt: 'x' },
      { id: 'b2', name: 'off', config: { ...baseReq, silent: false }, createdAt: 'x' },
    ]);
    const back = db.readCollection<{ id: string; config: { silent?: boolean } }>('bookmarks.json');
    expect(back.find((b) => b.id === 'b1')?.config.silent).toBe(true);
    expect(back.find((b) => b.id === 'b2')?.config.silent).toBe(false);
  });

  it('history: silent flag survives write→read', () => {
    const db = openLocalDb(':memory:');
    const rec: RunRecord = {
      id: 'r1',
      request: { ...baseReq, silent: true, noTrack: false },
      command: 'run',
      status: 'passed',
      startedAt: '2026-01-01T00:00:00.000Z',
    };
    db.appendHistory(rec);
    const back = db.readCollection<RunRecord>('history');
    expect(back[0]?.request.silent).toBe(true);
    expect(back[0]?.request.noTrack).toBe(false);
  });
});
