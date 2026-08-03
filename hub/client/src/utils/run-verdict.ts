import type { RunSummary } from '@hub/shared';
import type { TranslationKey } from '~/i18n/en';

/**
 * One-sentence outcome of a finished run, built from the parsed pass/fail/skip
 * counts. A missing or all-zero summary means the runner finished without
 * executing a check (cancelled, config error, empty selection). Severity is not
 * carried on the run stream, so the Critical clause has no data to fill and is
 * left out rather than guessed.
 */
export function runVerdict(summary: RunSummary | null, t: (key: TranslationKey) => string): string {
  const total = summary ? summary.passed + summary.failed + (summary.skipped ?? 0) : 0;
  if (total === 0) return t('run.verdictNoChecks');
  if (summary && summary.failed > 0) {
    return t('run.verdictFailed')
      .replace('{failed}', String(summary.failed))
      .replace('{total}', String(total));
  }
  return t('run.verdictAllPassed').replace('{total}', String(total));
}
