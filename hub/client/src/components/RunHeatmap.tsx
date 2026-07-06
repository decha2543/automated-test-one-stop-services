import type { RunRecord } from '@hub/shared';
import { Heatmap } from '@mantine/charts';
import { Box, Group, SegmentedControl, Stack, Text, useMantineColorScheme } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { api } from '~/api/client.js';

type Metric = 'total' | 'failed' | 'passed';

const COLORS_PASSED_DARK = ['#1f2937', '#14532d', '#15803d', '#22c55e', '#86efac'];
const COLORS_PASSED_LIGHT = ['#f3f4f6', '#bbf7d0', '#4ade80', '#16a34a', '#15803d'];
const COLORS_FAILED_DARK = ['#1f2937', '#7f1d1d', '#b91c1c', '#ef4444', '#fca5a5'];
const COLORS_FAILED_LIGHT = ['#f3f4f6', '#fecaca', '#f87171', '#dc2626', '#991b1b'];
const COLORS_TOTAL_DARK = ['#1f2937', '#1e3a8a', '#1d4ed8', '#3b82f6', '#93c5fd'];
const COLORS_TOTAL_LIGHT = ['#f3f4f6', '#bfdbfe', '#60a5fa', '#2563eb', '#1e40af'];

interface DayBucket {
  total: number;
  passed: number;
  failed: number;
}

function aggregate(records: RunRecord[]): Record<string, DayBucket> {
  const map: Record<string, DayBucket> = {};
  for (const r of records) {
    const ts = r.endedAt ?? r.startedAt;
    if (!ts) continue;
    const day = ts.slice(0, 10);
    const bucket = map[day] ?? { total: 0, passed: 0, failed: 0 };
    bucket.total++;
    if (r.status === 'passed') bucket.passed++;
    else if (r.status === 'failed') bucket.failed++;
    map[day] = bucket;
  }
  return map;
}

export function RunHeatmap() {
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === 'dark';
  const [metric, setMetric] = useState<Metric>('total');
  const { ref, width } = useElementSize();

  const history = useQuery<RunRecord[]>({
    queryKey: ['runs-history'],
    queryFn: () => api.get('/api/runs/history'),
  });

  if (history.isLoading) {
    return (
      <Text c="dimmed" size="sm">
        Loading heatmap...
      </Text>
    );
  }
  if (!history.data || history.data.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        No run history yet. Run some tests to see activity.
      </Text>
    );
  }

  const buckets = aggregate(history.data);
  const data: Record<string, number> = {};
  for (const [day, b] of Object.entries(buckets)) {
    data[day] = b[metric];
  }

  const colorMap: Record<Metric, string[]> = {
    total: isDark ? COLORS_TOTAL_DARK : COLORS_TOTAL_LIGHT,
    passed: isDark ? COLORS_PASSED_DARK : COLORS_PASSED_LIGHT,
    failed: isDark ? COLORS_FAILED_DARK : COLORS_FAILED_LIGHT,
  };

  const today = dayjs().format('YYYY-MM-DD');
  const yearAgo = dayjs().subtract(1, 'year').format('YYYY-MM-DD');

  const totalRuns = Object.values(buckets).reduce((s, b) => s + b.total, 0);
  const totalFailed = Object.values(buckets).reduce((s, b) => s + b.failed, 0);
  const totalPassed = Object.values(buckets).reduce((s, b) => s + b.passed, 0);

  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="wrap">
        <Text size="xs" c="dimmed">
          {totalRuns} runs · {totalPassed} passed · {totalFailed} failed (last 12 months)
        </Text>
        <SegmentedControl
          size="xs"
          value={metric}
          onChange={(v) => setMetric(v as Metric)}
          data={[
            { value: 'total', label: 'Total' },
            { value: 'passed', label: 'Passed' },
            { value: 'failed', label: 'Failed' },
          ]}
        />
      </Group>
      <Box ref={ref} miw={0} mih={0} style={{ overflow: 'hidden' }}>
        {width > 0 && (
          <Heatmap
            data={data}
            startDate={yearAgo}
            endDate={today}
            withTooltip
            withWeekdayLabels
            withMonthLabels
            withLegend
            colors={colorMap[metric]}
            getTooltipLabel={({ date, value: _value }) => {
              const b = buckets[date];
              const dateStr = dayjs(date).format('DD MMM YYYY');
              if (!b) return `${dateStr} — No runs`;
              return `${dateStr} — ${b.total} run${b.total === 1 ? '' : 's'} (${b.passed} passed, ${b.failed} failed)`;
            }}
          />
        )}
      </Box>
    </Stack>
  );
}
