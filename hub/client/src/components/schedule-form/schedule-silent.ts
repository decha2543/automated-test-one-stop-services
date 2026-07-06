import type { RunRequest } from '@hub/shared';

/**
 * Pure mapping helpers for the ScheduleForm "Silent mode" checkbox <-> the
 * persisted `RunRequest.config.silent` flag.
 *
 * These are extracted from the inline form logic so the form/config round-trip
 * can be exercised as a pure function (see Property 14). The component uses
 * these exact helpers so the test reflects real behaviour.
 */

/**
 * Map the form's `silent` checkbox boolean to the value stored on the run
 * config. A checked box yields `true`; an unchecked box yields `undefined`
 * (the flag is omitted entirely, i.e. treated as a normal run) rather than
 * `false`, matching the historical `silent || undefined` behaviour.
 */
export function toConfigSilent(checkbox: boolean): boolean | undefined {
  return checkbox || undefined;
}

/**
 * Map an existing run config back to the form's `silent` checkbox boolean.
 * A config with `silent === true` initializes the checkbox ON; any other
 * value (`undefined`, `false`) initializes it OFF, matching the historical
 * `schedule.config.silent ?? false` behaviour.
 */
export function fromConfigSilent(config: Pick<RunRequest, 'silent'>): boolean {
  return config.silent ?? false;
}
