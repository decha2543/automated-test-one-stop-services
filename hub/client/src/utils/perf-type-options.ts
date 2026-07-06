import type { EnvEntry, PerformanceType } from '@hub/shared';

/**
 * Engine fallback VU counts, used when the project's `.env` leaves the matching
 * key blank. KEEP IN SYNC with the source of truth in the k6 tool:
 * `tools/k6/resources/src/configs/env-variable.ts` (`peakVus`, `minimalLoadVus`).
 */
const DEFAULT_PEAK_VUS = 1000;
const DEFAULT_MINIMAL_LOAD_VUS = 500;

/**
 * Peak-VU multiplier (relative to LOAD/`peakVus`) for the heavier profile.
 * Mirrors `STRESS_PEAK_FACTOR` in the engine
 * (`tools/k6/resources/src/configs/test-options.ts`) — KEEP IN SYNC.
 */
const STRESS_PEAK_FACTOR = 2;

/**
 * Per-profile display metadata. `vus(peak, minimal)` returns the profile's peak
 * concurrent VUs; `note` is a short shape hint shown in parentheses, phrased
 * relative to the LOAD baseline so the dropdown reads at a glance.
 *
 * KEEP IN SYNC with the engine profiles in
 * `tools/k6/resources/src/configs/test-options.ts` (`PROFILES` + the
 * `*_PEAK_FACTOR` constants) — the multipliers and the TEST_PROTOCOL target are
 * mirrored here for display only.
 * ponytail: the two packages share no module (one runs in the k6 runtime, the
 * other in the browser), so this is a documented copy of ~5 stable numbers
 * rather than cross-package plumbing. Ceiling: if the engine formulas change,
 * update both. Upgrade path: surface a profile descriptor from a shared source
 * consumed by engine + Hub.
 */
const PERF_META: {
  id: PerformanceType;
  label: string;
  vus: (peak: number, minimal: number) => number;
  note?: string;
}[] = [
  { id: 'TEST_PROTOCOL', label: 'Test Protocol', vus: () => 5, note: 'validation' },
  { id: 'MINIMAL_LOAD', label: 'Minimal Load', vus: (_peak, minimal) => minimal },
  { id: 'LOAD', label: 'Load', vus: (peak) => peak },
  { id: 'STRESS', label: 'Stress', vus: (peak) => peak * STRESS_PEAK_FACTOR, note: '2× Load' },
  { id: 'ENDURANCE', label: 'Endurance', vus: (peak) => peak, note: 'sustained Load' },
  { id: 'PEAK', label: 'Peak', vus: (peak) => peak, note: 'Load spike' },
];

/** Positive integer from an env value, or undefined when blank/invalid. */
function envInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
}

/**
 * Build the perf-type Select options, annotating each with its peak VU count and
 * a shape hint, e.g. `Load (1000 VUs)`, `Stress (2000 VUs, peak ×2)`. The peak
 * (PEAK_VUS) and minimal (MINIMAL_LOAD_VUS) counts come from the project's
 * `.env` when set, else the engine defaults; the other profiles derive from the
 * peak via the multipliers above. Pass the entries from `GET /api/env/project`;
 * `undefined` (before env loads) falls back to the defaults so a number always
 * shows.
 */
export function buildPerfTypeData(
  entries: readonly EnvEntry[] | undefined,
): { value: PerformanceType; label: string }[] {
  const envValue = (key: string): string | undefined => entries?.find((e) => e.key === key)?.value;
  const peak = envInt(envValue('PEAK_VUS')) ?? DEFAULT_PEAK_VUS;
  const minimal = envInt(envValue('MINIMAL_LOAD_VUS')) ?? DEFAULT_MINIMAL_LOAD_VUS;

  return PERF_META.map(({ id, label, vus, note }) => {
    const count = vus(peak, minimal);
    const detail = note ? `${count} VUs, ${note}` : `${count} VUs`;
    return { value: id, label: `${label} (${detail})` };
  });
}
