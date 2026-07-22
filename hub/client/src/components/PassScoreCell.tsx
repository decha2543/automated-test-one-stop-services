import type { RunSummary, SeverityBreakdown } from '@hub/shared';
import { SEVERITY_LEVELS, weightedPassPercent } from '@hub/shared';
import { Group, Text, Tooltip } from '@mantine/core';
import { useT } from '~/i18n/index.js';

/**
 * Severity-weighted pass score cell, shared by the History and Reports tables.
 *
 * - When a `severity` breakdown is present → weighted % (critical×4 / high×3 /
 *   medium×2 / low×1), tooltip shows per-level passed/failed counts.
 * - When only a `summary` is present → plain pass rate, tooltip notes the reason.
 * - When neither is present → dash.
 *
 * Color scale: ≥80% green · ≥50% yellow · <50% red.
 */
export function PassScoreCell({
  summary,
  severity,
}: {
  summary?: RunSummary;
  severity?: SeverityBreakdown;
}) {
  const t = useT();

  if (!summary && !severity) {
    return (
      <Text size="xs" c="dimmed">
        —
      </Text>
    );
  }

  const weighted = severity ? weightedPassPercent(severity) : null;

  let pct: number | null = null;
  if (weighted !== null) {
    pct = weighted;
  } else if (summary) {
    const total = summary.passed + summary.failed + (summary.skipped ?? 0);
    pct = total > 0 ? (summary.passed / total) * 100 : null;
  }

  const display = pct !== null ? `${pct.toFixed(1)}%` : '—';
  const color =
    pct === null
      ? ('dimmed' as const)
      : pct >= 80
        ? ('green' as const)
        : pct >= 50
          ? ('yellow' as const)
          : ('red' as const);

  const tooltipLines: string[] = [];
  if (weighted !== null && severity) {
    tooltipLines.push(t('reports.scoreWeighted'));
    for (const level of SEVERITY_LEVELS) {
      const { passed, failed } = severity[level];
      if (passed + failed === 0) continue;
      tooltipLines.push(
        t('reports.scoreSeverityRow')
          .replace('{level}', level)
          .replace('{passed}', String(passed))
          .replace('{failed}', String(failed)),
      );
    }
  } else {
    tooltipLines.push(t('reports.scoreNoSeverity'));
    if (summary) {
      const total = summary.passed + summary.failed + (summary.skipped ?? 0);
      tooltipLines.push(
        `${summary.passed} ${t('run.passed')} · ${summary.failed} ${t('run.failed')}` +
          (summary.skipped ? ` · ${summary.skipped} ${t('run.skipped')}` : '') +
          ` / ${total}`,
      );
    }
  }

  return (
    <Tooltip
      label={
        <Text size="xs" style={{ whiteSpace: 'pre-line' }}>
          {tooltipLines.join('\n')}
        </Text>
      }
      withArrow
    >
      <Group gap={4} wrap="nowrap">
        <Text size="xs" fw={600} c={color}>
          {display}
        </Text>
        {summary && (
          <Text size="xs" c="dimmed">
            ({summary.passed}/{summary.passed + summary.failed + (summary.skipped ?? 0)})
          </Text>
        )}
      </Group>
    </Tooltip>
  );
}
