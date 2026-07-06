import type { RunRecord } from '@hub/shared';
import { AreaChart } from '@mantine/charts';
import { Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { api } from '~/api/client.js';

interface DayStats {
  date: string;
  passed: number;
  failed: number;
  total: number;
}

function aggregateByDay(records: RunRecord[]): DayStats[] {
  const map = new Map<string, { passed: number; failed: number }>();

  for (const r of records) {
    if (!r.endedAt) continue;
    const date = r.endedAt.slice(0, 10); // YYYY-MM-DD
    const entry = map.get(date) ?? { passed: 0, failed: 0 };
    if (r.status === 'passed') entry.passed++;
    else if (r.status === 'failed') entry.failed++;
    map.set(date, entry);
  }

  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14) // Last 14 days
    .map(([date, stats]) => ({
      date: date.slice(5), // MM-DD
      passed: stats.passed,
      failed: stats.failed,
      total: stats.passed + stats.failed,
    }));
}

/**
 * Stacked area chart for the last 14 days of pass/fail counts.
 *
 * Switched from `recharts` directly to `@mantine/charts` (which still uses
 * recharts under the hood, but ships the deduplicated copy that Mantine
 * already pulls in). Saves ~135KB gzipped from the bundle.
 */
export function TrendChart() {
  const history = useQuery<RunRecord[]>({
    queryKey: ['runs-history'],
    queryFn: () => api.get('/api/runs/history'),
  });

  if (history.isLoading)
    return (
      <Text c="dimmed" size="sm">
        Loading chart...
      </Text>
    );
  if (!history.data || history.data.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        No run history yet. Run some tests to see trends.
      </Text>
    );
  }

  const data = aggregateByDay(history.data);
  if (data.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        No completed runs to chart.
      </Text>
    );
  }

  return (
    <AreaChart
      h={220}
      data={data}
      dataKey="date"
      type="stacked"
      withLegend
      withDots={false}
      tickLine="x"
      gridAxis="xy"
      series={[
        { name: 'passed', label: 'Passed', color: 'green.6' },
        { name: 'failed', label: 'Failed', color: 'red.6' },
      ]}
    />
  );
}
