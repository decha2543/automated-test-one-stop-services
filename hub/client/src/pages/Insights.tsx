import { Tabs } from '@mantine/core';
import { useState } from 'react';
import { TbChartLine, TbFlame } from 'react-icons/tb';
import { useT } from '~/i18n/index.js';
import { FlakyTestsPage } from './FlakyTests.js';
import { PerformancePage } from './Performance.js';

type InsightsTab = 'flaky' | 'performance';

export function InsightsPage() {
  const t = useT();
  const [tab, setTab] = useState<InsightsTab>('flaky');

  return (
    <Tabs value={tab} onChange={(v) => setTab((v as InsightsTab) ?? 'flaky')}>
      <Tabs.List mb="md">
        <Tabs.Tab value="flaky" leftSection={<TbFlame size={16} />}>
          {t('nav.flakyTests')}
        </Tabs.Tab>
        <Tabs.Tab value="performance" leftSection={<TbChartLine size={16} />}>
          {t('nav.performance')}
        </Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="flaky">
        <FlakyTestsPage />
      </Tabs.Panel>
      <Tabs.Panel value="performance">
        <PerformancePage />
      </Tabs.Panel>
    </Tabs>
  );
}
