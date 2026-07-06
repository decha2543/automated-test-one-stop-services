import type { DoctorReport, RunRequest } from '@hub/shared';
import {
  AppShell,
  Badge,
  Burger,
  Center,
  Group,
  Kbd,
  Loader,
  NavLink,
  ScrollArea,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { spotlight } from '@mantine/spotlight';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { Suspense, useCallback, useState } from 'react';
import {
  TbAdjustmentsHorizontal,
  TbBrandDocker,
  TbCalendarTime,
  TbChartBar,
  TbChartLine,
  TbChevronDown,
  TbChevronRight,
  TbFolderFilled,
  TbHistory,
  TbKey,
  TbPhoto,
  TbPlayerPlay,
  TbReportAnalytics,
  TbSettings,
} from 'react-icons/tb';
import { api } from '~/api/client.js';
import { qActiveRuns } from '~/api/queries.js';
import { ActiveRunsBanner } from '~/components/ActiveRunsBanner.js';
import { ErrorBoundary } from '~/components/ErrorBoundary.js';
import { FloatingRunsWindow } from '~/components/FloatingRunsWindow.js';
import { KeyboardShortcuts } from '~/components/KeyboardShortcuts.js';
import { LanguageToggle } from '~/components/LanguageToggle.js';
import { NotificationCenter } from '~/components/NotificationCenter.js';
import { SpotlightSearch } from '~/components/SpotlightSearch.js';
import { useScheduleToasts } from '~/hooks/useScheduleToasts.js';
import type { TranslationKey } from '~/i18n/en';
import { useT } from '~/i18n/index.js';
import { useNavigationStore } from '~/stores/navigation.js';

// ---------------------------------------------------------------------------
// Nav structure
// ---------------------------------------------------------------------------

type PagePath =
  | '/'
  | '/run'
  | '/history'
  | '/schedules'
  | '/projects'
  | '/env-profiles'
  | '/reports'
  | '/artifacts'
  | '/insights'
  | '/docker'
  | '/webhooks'
  | '/settings';

interface NavCategory {
  labelKey: TranslationKey;
  /** When true the whole category is tucked behind the "Advanced" toggle. */
  advanced?: boolean;
  items: {
    path: PagePath;
    labelKey: TranslationKey;
    descKey: TranslationKey;
    icon: React.ReactNode;
  }[];
}

const NAV_CATEGORIES: NavCategory[] = [
  {
    labelKey: 'nav.workspace',
    items: [
      {
        path: '/',
        labelKey: 'nav.dashboard',
        descKey: 'nav.dashboard.desc',
        icon: <TbChartBar size={18} />,
      },
      {
        path: '/run',
        labelKey: 'nav.runTests',
        descKey: 'nav.runTests.desc',
        icon: <TbPlayerPlay size={18} />,
      },
      {
        path: '/reports',
        labelKey: 'nav.reports',
        descKey: 'nav.reports.desc',
        icon: <TbReportAnalytics size={18} />,
      },
      {
        path: '/history',
        labelKey: 'nav.history',
        descKey: 'nav.history.desc',
        icon: <TbHistory size={18} />,
      },
      {
        path: '/schedules',
        labelKey: 'nav.schedules',
        descKey: 'nav.schedules.desc',
        icon: <TbCalendarTime size={18} />,
      },
    ],
  },
  {
    labelKey: 'nav.manage',
    items: [
      {
        path: '/projects',
        labelKey: 'nav.projects',
        descKey: 'nav.projects.desc',
        icon: <TbFolderFilled size={18} />,
      },
      {
        path: '/env-profiles',
        labelKey: 'nav.envProfiles',
        descKey: 'nav.envProfiles.desc',
        icon: <TbKey size={18} />,
      },
      {
        path: '/artifacts',
        labelKey: 'nav.artifacts',
        descKey: 'nav.artifacts.desc',
        icon: <TbPhoto size={18} />,
      },
    ],
  },
  {
    labelKey: 'nav.insights',
    items: [
      {
        path: '/insights',
        labelKey: 'nav.insights',
        descKey: 'nav.insights.desc',
        icon: <TbChartLine size={18} />,
      },
    ],
  },
  {
    labelKey: 'nav.infrastructure',
    advanced: true,
    items: [
      {
        path: '/docker',
        labelKey: 'nav.docker',
        descKey: 'nav.docker.desc',
        icon: <TbBrandDocker size={18} />,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Layout component
// ---------------------------------------------------------------------------

/** Max content width. Caps line length on ultrawide screens; pages still go
 * full width below this. One knob to widen/narrow every page at once. */
const CONTENT_MAX_WIDTH = 1600;

function PageFallback() {
  const t = useT();
  return (
    <Center h="100%" mih={200}>
      <Group gap="sm">
        <Loader size="sm" />
        <Text c="dimmed" size="sm">
          {t('common.loading')}
        </Text>
      </Group>
    </Center>
  );
}

export function AppLayout() {
  const t = useT();
  const navigate = useNavigate();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname as PagePath;

  const [opened, { toggle, close }] = useDisclosure();
  const [floatingOpen, setFloatingOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const setPendingRunConfig = useNavigationStore((s) => s.setPendingRunConfig);

  // App-level Corner_Toast listener for `schedule-finished` (Area D, task 7.3).
  // Surfaces schedule completion toasts on any page; ephemeral, never persisted.
  useScheduleToasts();

  // Global running indicator
  const activeRuns = useQuery({
    ...qActiveRuns(),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && data.length > 0 ? 3000 : 30_000;
    },
  });
  const runningCount = activeRuns.data?.length ?? 0;

  // Doctor poll for nav badge
  const doctorQ = useQuery<DoctorReport>({
    queryKey: ['doctor-nav'],
    queryFn: () => api.get('/api/doctor'),
    staleTime: 120_000,
  });
  const envUnhealthy = doctorQ.data ? !doctorQ.data.overallOk : false;

  function navigateTo(path: PagePath) {
    navigate({ to: path });
    close();
  }

  // Quick run from spotlight
  const handleQuickRun = useCallback(
    (config: RunRequest) => {
      setPendingRunConfig(config);
      navigate({ to: '/run' });
    },
    [navigate, setPendingRunConfig],
  );

  // Spotlight navigation adapter (accepts string page names for backward compat)
  const handleSpotlightNavigate = useCallback(
    (page: string) => {
      const path = page === 'dashboard' ? '/' : (`/${page}` as PagePath);
      navigate({ to: path });
      close();
    },
    [navigate, close],
  );

  const handleSpotlightBookmark = useCallback(
    (config: RunRequest) => {
      handleQuickRun(config);
    },
    [handleQuickRun],
  );

  const renderCategory = (cat: NavCategory) => (
    <div key={cat.labelKey}>
      <Text size="xs" fw={700} c="dimmed" tt="uppercase" px="sm" pt="md" pb={4}>
        {t(cat.labelKey)}
      </Text>
      {cat.items.map((item) => (
        <Tooltip
          key={item.path}
          label={t(item.descKey)}
          position="right"
          withArrow
          openDelay={400}
          multiline
          w={240}
        >
          <NavLink
            label={t(item.labelKey)}
            leftSection={item.icon}
            active={currentPath === item.path}
            onClick={() => navigateTo(item.path)}
            variant="filled"
            rightSection={
              item.path === '/run' && runningCount > 0 ? (
                <Badge size="xs" color="blue" circle>
                  {runningCount}
                </Badge>
              ) : item.path === '/' && envUnhealthy ? (
                <Tooltip label={t('app.envNeedsAttention')} withArrow>
                  <Badge size="xs" color="red" circle>
                    !
                  </Badge>
                </Tooltip>
              ) : null
            }
          />
        </Tooltip>
      ))}
    </div>
  );

  return (
    <>
      <SpotlightSearch
        onNavigate={handleSpotlightNavigate}
        onLoadBookmark={handleSpotlightBookmark}
      />
      <KeyboardShortcuts />

      <AppShell
        header={{ height: 56 }}
        navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
        padding="md"
      >
        <AppShell.Header>
          <Group h="100%" px="md" justify="space-between">
            <Group gap="sm">
              <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
              <img src="/logo.png" alt="Hub" style={{ height: 32, width: 'auto' }} />
              <Title order={4}>AutoQA Hub</Title>
              {runningCount > 0 && (
                <Tooltip label={t('app.peekRunning')}>
                  <Badge
                    color="blue"
                    variant="dot"
                    size="lg"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setFloatingOpen((v) => !v)}
                  >
                    {runningCount} {t('app.running')}
                  </Badge>
                </Tooltip>
              )}
            </Group>
            <Group gap="xs">
              <Tooltip label={t('app.searchHint')}>
                <Badge
                  variant="default"
                  size="lg"
                  style={{ cursor: 'pointer' }}
                  onClick={() => spotlight.open()}
                >
                  <Group gap={4}>
                    <Text size="xs" c="dimmed">
                      {t('common.search')}
                    </Text>
                    <Kbd size="xs">⌘K</Kbd>
                  </Group>
                </Badge>
              </Tooltip>
              <LanguageToggle />
              <NotificationCenter />
            </Group>
          </Group>
        </AppShell.Header>

        <AppShell.Navbar p="xs">
          <AppShell.Section grow component={ScrollArea}>
            {NAV_CATEGORIES.filter((cat) => !cat.advanced).map(renderCategory)}
            <NavLink
              mt="xs"
              label={t('nav.advanced')}
              leftSection={<TbAdjustmentsHorizontal size={18} />}
              rightSection={
                showAdvanced ? <TbChevronDown size={14} /> : <TbChevronRight size={14} />
              }
              onClick={() => setShowAdvanced((v) => !v)}
              variant="subtle"
            />
            {showAdvanced && NAV_CATEGORIES.filter((cat) => cat.advanced).map(renderCategory)}
          </AppShell.Section>
          <AppShell.Section>
            <Tooltip
              label={t('nav.settings.desc')}
              position="right"
              withArrow
              openDelay={400}
              multiline
              w={240}
            >
              <NavLink
                label={t('nav.settings')}
                leftSection={<TbSettings size={18} />}
                active={currentPath === '/settings'}
                onClick={() => navigateTo('/settings')}
                variant="filled"
              />
            </Tooltip>
          </AppShell.Section>
        </AppShell.Navbar>

        <AppShell.Main style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Centered, width-capped content column. Keeps line lengths readable
          on ultrawide monitors instead of stretching forms/tables edge-to-edge,
          while preserving the full-height flex chain that pages like Run rely on.
          Tune CONTENT_MAX_WIDTH in one place to widen/narrow every page. */}
          <div
            style={{
              width: '100%',
              maxWidth: CONTENT_MAX_WIDTH,
              marginInline: 'auto',
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {runningCount > 0 && currentPath !== '/run' && (
              <div style={{ marginBottom: 12, flexShrink: 0 }}>
                <ActiveRunsBanner runs={activeRuns.data ?? []} />
              </div>
            )}
            <div style={{ flex: 1, minHeight: 0 }}>
              <ErrorBoundary>
                <Suspense fallback={<PageFallback />}>
                  <Outlet />
                </Suspense>
              </ErrorBoundary>
            </div>
          </div>
        </AppShell.Main>
      </AppShell>

      <FloatingRunsWindow
        runs={activeRuns.data ?? []}
        visible={floatingOpen && currentPath !== '/run'}
        onClose={() => setFloatingOpen(false)}
        onJumpToRuns={() => {
          setFloatingOpen(false);
          navigateTo('/run');
        }}
      />
    </>
  );
}
