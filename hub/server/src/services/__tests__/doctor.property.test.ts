// Feature: install-and-provisioning-overhaul, Property 2: Folder-presence gates
// provisioning and doctor checks.
//
// For any tool id and any set of present/absent tool folders, a tool's Doctor
// check is classified `required-install` iff its folder is present; when the
// folder is absent the self-check is a non-required (`optional-install`) check
// that never forces overall failure and never prevents a separate component
// from independently declaring that tool required.
//
// **Validates: Requirements 4.2, 4.3, 4.4, 5.2, 5.3**
//
// One property; >=100 iterations; fast-check under Vitest. The unit under test
// is the pure, exported gating core of `hub/server/src/services/doctor.ts`
// (`toolCheckCategory` + `computeOverallOk`); the `fs.existsSync` folder probe
// they feed is a thin Node-stdlib call exercised by the live `runDoctor`
// wiring, not re-tested here.

import type { DoctorCheck } from '@hub/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeOverallOk, toolCheckCategory } from '../doctor.js';

/**
 * A generated tool's gating inputs: its id, whether its `tools/<id>/` folder is
 * present, and the probe result used only when the tool is present.
 */
interface ToolGate {
  readonly id: string;
  readonly present: boolean;
  readonly probeOk: boolean;
}

const arbToolGate: fc.Arbitrary<ToolGate> = fc.record({
  id: fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/),
  present: fc.boolean(),
  probeOk: fc.boolean(),
});

/** A set of tool gates with unique ids (one Doctor check per tool name). */
const arbToolGateSet: fc.Arbitrary<readonly ToolGate[]> = fc
  .array(arbToolGate, { maxLength: 8 })
  .map((gates) => {
    const seen = new Set<string>();
    const unique: ToolGate[] = [];
    for (const gate of gates) {
      if (seen.has(gate.id)) continue;
      seen.add(gate.id);
      unique.push(gate);
    }
    return unique;
  });

/**
 * Build the Doctor check a folder-presence gate produces, mirroring `doctor.ts`:
 * present -> a mandatory check whose `ok` is the probe result; absent -> a
 * passing non-required self-check. The category comes from the real exported
 * `toolCheckCategory`, so this exercises the production classifier directly.
 */
function gateToCheck(gate: ToolGate): DoctorCheck {
  return {
    name: gate.id,
    ok: gate.present ? gate.probeOk : true,
    category: toolCheckCategory(gate.present),
  };
}

describe('Feature: install-and-provisioning-overhaul, Property 2', () => {
  it('classifies required-install iff the tool folder is present; absent self-checks never force failure nor suppress an independent required check', () => {
    fc.assert(
      fc.property(arbToolGateSet, (gates) => {
        const pairs = gates.map((gate) => ({ gate, check: gateToCheck(gate) }));
        const checks = pairs.map((p) => p.check);

        for (const { gate, check } of pairs) {
          if (gate.present) {
            // Present folder -> mandatory required-install classification (R5.2).
            expect(check.category).toBe('required-install');
          } else {
            // Absent folder -> a non-required self-check, never required, and
            // never itself a failure (R4.4, R5.3).
            expect(check.category).toBe('optional-install');
            expect(check.category).not.toBe('required-install');
            expect(check.ok).toBe(true);
          }
        }

        // `overallOk` is decided solely by present tools' probes; absent
        // self-checks drop out entirely (R4.3, R4.4).
        const expectedOverall = gates.filter((g) => g.present).every((g) => g.probeOk);
        expect(computeOverallOk(checks)).toBe(expectedOverall);

        // An absent tool's self-check never PREVENTS a separate component from
        // independently declaring that tool required: a failing required-install
        // check for the same absent tool still fails overall, proving the
        // optional self-check neither suppresses nor overrides it (R5.2, R5.3).
        const absent = gates.find((g) => !g.present);
        if (absent) {
          const independentlyRequired: DoctorCheck = {
            name: absent.id,
            ok: false,
            category: 'required-install',
            hint: 'required by another component',
          };
          expect(computeOverallOk([...checks, independentlyRequired])).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });
});
