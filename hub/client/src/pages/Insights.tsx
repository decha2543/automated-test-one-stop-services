import { Tabs } from '@mantine/core';
import { lazy, Suspense, useState } from 'react';
import { TbChartLine, TbFlame } from 'react-icons/tb';
import { ListSkeleton, StatCardsSkeleton } from '~/components/Skeletons.js';
import { useT } from '~/i18n/index.js';

// Code-split each tab into its own chunk. Flaky and Performance were previously
// imported eagerly, so opening Insights pulled both pages (and their charts) in
// one chunk. lazy() defers each until its tab is first opened.
const FlakyTestsPage = lazy(() =>
  import('./FlakyTests.js').then((m) => ({ default: m.FlakyTestsPage })),
);
const PerformancePage = lazy(() =>
  import('./Performance.js').then((m) => ({ default: m.PerformancePage })),
);

type InsightsTab = 'flaky' | 'performance';

export function InsightsPage() {
  const t = useT();
  const [tab, setTab] = useState<InsightsTab>('flaky');
  // Track which tabs have been opened: each page's chunk loads on first visit,
  // then stays mounted so its local filter state survives tab switches and
  // React Query serves cached data (no refetch flash on switch back).
  const [opened, setOpened] = useState<Set<InsightsTab>>(() => new Set<InsightsTab>(['flaky']));

  const selectTab = (value: string | null) => {
    const next = (value as InsightsTab) ?? 'flaky';
    setTab(next);
    setOpened((prev) => {
      if (prev.has(next)) return prev;
      const updated = new Set(prev);
      updated.add(next);
      return updated;
    });
  };

  return (
    <Tabs value={tab} onChange={selectTab}>
      <Tabs.List mb="md">
        <Tabs.Tab value="flaky" leftSection={<TbFlame size={16} />}>
          {t('nav.flakyTests')}
        </Tabs.Tab>
        <Tabs.Tab value="performance" leftSection={<TbChartLine size={16} />}>
          {t('nav.performance')}
        </Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="flaky">
        {opened.has('flaky') && (
          <Suspense fallback={<ListSkeleton />}>
            <FlakyTestsPage />
          </Suspense>
        )}
      </Tabs.Panel>
      <Tabs.Panel value="performance">
        {opened.has('performance') && (
          <Suspense fallback={<StatCardsSkeleton />}>
            <PerformancePage />
          </Suspense>
        )}
      </Tabs.Panel>
    </Tabs>
  );
}
