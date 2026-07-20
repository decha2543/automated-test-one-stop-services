import type { QueryClient } from '@tanstack/react-query';
import {
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router';
import { qActiveRuns, qDoctor, qProjects, qRunsHistory } from './api/queries.js';
import { queryClient } from './api/query-client.js';
import { AppLayout } from './components/AppLayout.js';
import { PageLoader } from './components/PageLoader.js';

// ---------------------------------------------------------------------------
// Router context — gives every route loader access to the shared QueryClient
// so it can `ensureQueryData` before the page component mounts.
// ---------------------------------------------------------------------------

interface RouterContext {
  queryClient: QueryClient;
}

// ---------------------------------------------------------------------------
// Root layout route
// ---------------------------------------------------------------------------

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: AppLayout,
});

// ---------------------------------------------------------------------------
// Page routes — code-split via lazyRouteComponent
// ---------------------------------------------------------------------------

export const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  // Prefetch the three dashboard queries in parallel at navigation time so the
  // page renders with data already in cache (no render-then-fetch waterfall).
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(qDoctor()),
      context.queryClient.ensureQueryData(qProjects()),
      context.queryClient.ensureQueryData(qRunsHistory()),
    ]),
  component: lazyRouteComponent(() => import('./pages/Dashboard.js'), 'DashboardPage'),
});

export const runRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/run',
  // Run page gates on whether any projects exist and reconnects to active runs.
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(qProjects()),
      context.queryClient.ensureQueryData(qActiveRuns()),
    ]),
  component: lazyRouteComponent(() => import('./pages/Run.js'), 'RunPage'),
});

export const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/history',
  loader: ({ context }) => context.queryClient.ensureQueryData(qRunsHistory()),
  component: lazyRouteComponent(() => import('./pages/History.js'), 'HistoryPage'),
});

export const schedulesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/schedules',
  component: lazyRouteComponent(() => import('./pages/Schedules.js'), 'SchedulesPage'),
});

export const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: lazyRouteComponent(() => import('./pages/Projects.js'), 'ProjectsPage'),
});

export const envProfilesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/env-profiles',
  component: lazyRouteComponent(() => import('./pages/EnvProfiles.js'), 'EnvProfilesPage'),
});

export const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  component: lazyRouteComponent(() => import('./pages/Reports.js'), 'ReportsPage'),
});

export const artifactsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/artifacts',
  component: lazyRouteComponent(() => import('./pages/Artifacts.js'), 'ArtifactsPage'),
});

export const insightsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/insights',
  component: lazyRouteComponent(() => import('./pages/Insights.js'), 'InsightsPage'),
});

export const dockerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/docker',
  component: lazyRouteComponent(() => import('./pages/DockerServices.js'), 'DockerServicesPage'),
});

export const webhooksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/webhooks',
  component: lazyRouteComponent(() => import('./pages/Webhooks.js'), 'WebhooksPage'),
});

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: lazyRouteComponent(() => import('./pages/Settings.js'), 'SettingsPage'),
});

// ---------------------------------------------------------------------------
// Route tree & router
// ---------------------------------------------------------------------------

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  runRoute,
  historyRoute,
  schedulesRoute,
  projectsRoute,
  envProfilesRoute,
  reportsRoute,
  artifactsRoute,
  insightsRoute,
  dockerRoute,
  webhooksRoute,
  settingsRoute,
]);

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: 'intent',
  // Let React Query own caching/staleness: setting the router's own preload
  // stale time to 0 means loaders always re-run `ensureQueryData`, which is a
  // cache hit when the query is still fresh per its own `staleTime`.
  defaultPreloadStaleTime: 0,
  // Without a pending fallback the router paints nothing while the initial
  // route's loaders resolve — a blank dark page that looks like the app failed
  // to load. Render a loader instead, and with `defaultPendingMs: 0` show it
  // immediately rather than after the 1s default (navigations are local cache
  // hits, so this won't flash on route changes).
  defaultPendingComponent: () => <PageLoader boot />,
  defaultPendingMs: 0,
  context: { queryClient },
});

// Type-safe router declaration
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
