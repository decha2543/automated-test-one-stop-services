import type { Bookmark, ProjectSummary } from '@hub/shared';
import { Spotlight, type SpotlightActionData } from '@mantine/spotlight';
import { useQuery } from '@tanstack/react-query';
import {
  TbBookmark,
  TbCalendarTime,
  TbChartBar,
  TbFolderFilled,
  TbPlayerPlay,
  TbReportAnalytics,
  TbSettings,
} from 'react-icons/tb';
import { api } from '~/api/client.js';

interface SpotlightSearchProps {
  onNavigate: (page: string) => void;
  onLoadBookmark: (config: Bookmark['config']) => void;
}

export function SpotlightSearch({ onNavigate, onLoadBookmark }: SpotlightSearchProps) {
  const projects = useQuery<ProjectSummary[]>({
    queryKey: ['projects'],
    queryFn: () => api.get('/api/projects'),
  });

  const bookmarks = useQuery<Bookmark[]>({
    queryKey: ['bookmarks'],
    queryFn: () => api.get('/api/bookmarks'),
  });

  const navActions: SpotlightActionData[] = [
    {
      id: 'nav-dashboard',
      label: 'Dashboard',
      description: 'Environment status & test trends',
      leftSection: <TbChartBar size={18} />,
      onClick: () => onNavigate('dashboard'),
      keywords: ['home', 'overview', 'status'],
    },
    {
      id: 'nav-run',
      label: 'Run Tests',
      description: 'Execute test suites',
      leftSection: <TbPlayerPlay size={18} />,
      onClick: () => onNavigate('run'),
      keywords: ['execute', 'test', 'start'],
    },
    {
      id: 'nav-history',
      label: 'Run History',
      description: 'View past test executions',
      leftSection: <TbPlayerPlay size={18} />,
      onClick: () => onNavigate('history'),
      keywords: ['history', 'past', 'log', 'previous'],
    },
    {
      id: 'nav-schedules',
      label: 'Schedules',
      description: 'Manage scheduled test runs',
      leftSection: <TbCalendarTime size={18} />,
      onClick: () => onNavigate('schedules'),
      keywords: ['cron', 'timer', 'automatic'],
    },
    {
      id: 'nav-projects',
      label: 'Project Manager',
      description: 'Manage projects & environments',
      leftSection: <TbFolderFilled size={18} />,
      onClick: () => onNavigate('projects'),
      keywords: ['project', 'env', 'clone', 'create'],
    },
    {
      id: 'nav-reports',
      label: 'Reports',
      description: 'View test execution reports',
      leftSection: <TbReportAnalytics size={18} />,
      onClick: () => onNavigate('reports'),
      keywords: ['report', 'result', 'html'],
    },
    {
      id: 'nav-settings',
      label: 'Settings',
      description: 'Hub preferences & configuration',
      leftSection: <TbSettings size={18} />,
      onClick: () => onNavigate('settings'),
      keywords: ['preferences', 'config', 'options'],
    },
  ];

  const projectActions: SpotlightActionData[] = (projects.data ?? []).map((p) => ({
    id: `project-${p.tool}-${p.type}-${p.name}`,
    label: p.name,
    description: `${p.tool} / ${p.type}`,
    leftSection: <TbFolderFilled size={16} />,
    onClick: () => onNavigate('projects'),
    keywords: [p.tool, p.type, p.name],
    group: 'Projects',
  }));

  const bookmarkActions: SpotlightActionData[] = (bookmarks.data ?? []).map((bm) => {
    const c = bm.config;
    const detail = [c.tool, c.type, c.project, c.mode, c.tag].filter(Boolean).join(' · ');
    return {
      id: `bookmark-${bm.id}`,
      label: bm.name,
      description: detail,
      leftSection: <TbBookmark size={16} />,
      onClick: () => {
        onNavigate('run');
        onLoadBookmark(bm.config);
      },
      keywords: [c.tool, c.type, c.project, c.tag, bm.name].filter((v): v is string => !!v),
      group: 'Bookmarks',
    };
  });

  const actions = [...navActions, ...projectActions, ...bookmarkActions];

  return (
    <Spotlight
      actions={actions}
      nothingFound="No results found"
      highlightQuery
      searchProps={{
        placeholder: 'Search pages, projects, bookmarks...',
      }}
      shortcut="mod+K"
      scrollable
    />
  );
}
