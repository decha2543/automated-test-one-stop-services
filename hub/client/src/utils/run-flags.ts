/**
 * Typed run options that the Run form composes into CLI arguments, so a user
 * never has to remember a flag name.
 *
 * These are Playwright's argument spellings. The form only offers them for the
 * tools that accept them (see `SUPPORTS_RUN_FLAGS`) rather than passing a flag a
 * tool would reject.
 */
export interface RunFlagOptions {
  /** Parallel worker processes. Playwright's own default applies when unset. */
  workers?: number | null;
  /** Run each selected test N times — the flake hunt. */
  repeatEach?: number | null;
}

/** Tools whose CLI accepts the flags above. */
export const SUPPORTS_RUN_FLAGS = new Set(['playwright']);

/** Flag names this module owns — stripped from free text so typed values win. */
const OWNED_FLAGS = ['--workers', '--repeat-each'] as const;

/** A positive integer, or null when the field is empty / not a usable number. */
function positiveInt(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  return n >= 1 ? n : null;
}

/**
 * Render the typed options as CLI arguments. Empty options produce an empty
 * string, so a caller can always concatenate the result unconditionally.
 */
export function buildRunFlags(options: RunFlagOptions): string {
  const parts: string[] = [];
  const workers = positiveInt(options.workers);
  if (workers !== null) parts.push(`--workers=${workers}`);
  const repeatEach = positiveInt(options.repeatEach);
  if (repeatEach !== null) parts.push(`--repeat-each=${repeatEach}`);
  return parts.join(' ');
}

/**
 * Combine the user's free-text arguments with the typed flags.
 *
 * A flag this module owns is removed from the free text when the typed field
 * also sets it, so the two inputs cannot disagree and silently leave the CLI
 * with a duplicate. The free text is otherwise passed through untouched — it is
 * the escape hatch for anything not modelled here.
 */
export function mergeExtraArgs(
  freeText: string | undefined,
  options: RunFlagOptions,
): string | undefined {
  const flags = buildRunFlags(options);
  let text = (freeText ?? '').trim();
  if (text && flags) {
    for (const flag of OWNED_FLAGS) {
      if (!flags.includes(`${flag}=`)) continue;
      // Drop `--flag=value` and `--flag value` occurrences from the free text.
      text = text.replace(new RegExp(`\\s*${flag}(?:=|\\s+)\\S+`, 'g'), '');
    }
    text = text.trim();
  }
  const merged = [text, flags].filter(Boolean).join(' ').trim();
  return merged === '' ? undefined : merged;
}

/** {@link mergeExtraArgs} split back apart, plus whatever it did not model. */
export interface ParsedRunArgs extends RunFlagOptions {
  /** Free-text arguments left after the typed flags were lifted out. */
  rest: string;
}

/**
 * Inverse of {@link mergeExtraArgs}: lift the typed options back out of a stored
 * argument string so re-opening a saved bookmark or schedule shows them in their
 * own fields instead of leaving the fields blank while the run still uses them.
 *
 * Round-trip pair with `mergeExtraArgs` — a new owned flag must be added to both
 * (brain LESS-073). Anything not modelled here stays in `rest`, never dropped.
 */
export function parseRunArgs(extraArgs: string | undefined | null): ParsedRunArgs {
  let rest = (extraArgs ?? '').trim();
  const lift = (flag: string): number | null => {
    const m = rest.match(new RegExp(`${flag}(?:=|\\s+)(\\d+)`));
    if (!m?.[1]) return null;
    rest = rest.replace(m[0], '').trim();
    return Number(m[1]);
  };
  const workers = lift('--workers');
  const repeatEach = lift('--repeat-each');
  return { workers, repeatEach, rest };
}
