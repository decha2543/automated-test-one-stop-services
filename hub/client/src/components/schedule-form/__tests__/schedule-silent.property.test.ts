// Feature: one-stop-service-upgrade, Property 14: Schedule silent flag form/config round-trip
import type { RunRequest } from '@hub/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromConfigSilent, toConfigSilent } from '../schedule-silent.js';

/**
 * Property test for Task 5.7 — Schedule silent flag form/config round-trip.
 *
 * Validates: Requirements 8.2, 8.3, 8.4
 *
 * The "Silent mode" checkbox round-trips through the persisted run config:
 *   - saving with the checkbox ON yields `config.silent === true` (R8.2)
 *   - saving with the checkbox OFF yields a config WITHOUT `silent === true`
 *     (the flag is omitted / treated as a normal run) (R8.3)
 *   - loading an existing schedule into the form initializes the checkbox to
 *     match `config.silent` (R8.4)
 *
 * `toConfigSilent` / `fromConfigSilent` are the exact pure helpers the
 * ScheduleForm component uses for the form <-> config mapping.
 */

/** Build a minimal-but-valid RunRequest carrying a given `silent` value. */
function configWithSilent(silent: boolean | undefined): RunRequest {
  return {
    tool: 'playwright',
    type: 'e2e',
    project: 'demo',
    mode: 'local',
    silent,
  };
}

describe('Property 14: Schedule silent flag form/config round-trip', () => {
  it('maps checkbox ON to config.silent === true and OFF to absence of silent===true', () => {
    fc.assert(
      fc.property(fc.boolean(), (checkbox) => {
        const configSilent = toConfigSilent(checkbox);
        if (checkbox) {
          // R8.2: checkbox ON => config.silent === true
          expect(configSilent).toBe(true);
        } else {
          // R8.3: checkbox OFF => NOT silent===true (omitted / normal run)
          expect(configSilent).not.toBe(true);
          expect(configSilent).toBeUndefined();
        }
      }),
      { numRuns: 100 },
    );
  });

  it('round-trips checkbox -> config -> checkbox preserving the boolean', () => {
    fc.assert(
      fc.property(fc.boolean(), (checkbox) => {
        // checkbox -> config.silent -> checkbox should preserve the value.
        const config = configWithSilent(toConfigSilent(checkbox));
        expect(fromConfigSilent(config)).toBe(checkbox);
      }),
      { numRuns: 100 },
    );
  });

  it('initializes the checkbox to match an existing config.silent on load (R8.4)', () => {
    fc.assert(
      // An existing schedule may carry silent as true, false, or absent.
      fc.property(fc.option(fc.boolean(), { nil: undefined }), (stored) => {
        const checkbox = fromConfigSilent(configWithSilent(stored));
        // Only an explicit true initializes the checkbox ON; false/undefined => OFF.
        expect(checkbox).toBe(stored === true);
      }),
      { numRuns: 100 },
    );
  });

  it('round-trips an existing silent flag through load + save unchanged (R8.4)', () => {
    fc.assert(
      fc.property(fc.option(fc.boolean(), { nil: undefined }), (stored) => {
        // Load existing config into the form, then save back out.
        const checkbox = fromConfigSilent(configWithSilent(stored));
        const resaved = toConfigSilent(checkbox);
        // The canonical persisted value is preserved: true stays true; both
        // false and undefined collapse to "no silent" (undefined).
        const canonical = stored === true ? true : undefined;
        expect(resaved).toBe(canonical);
      }),
      { numRuns: 100 },
    );
  });
});
