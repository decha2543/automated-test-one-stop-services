export type DashboardWidgetId =
  | 'environment-status'
  | 'quick-launch'
  | 'recent-runs'
  | 'projects-overview'
  | 'test-trends'
  | 'top-projects'
  | 'run-activity'
  | 'flaky-tests'
  | 'project-health'
  | 'performance-summary'
  | 'tag-coverage';

export interface DashboardWidget {
  id: DashboardWidgetId;
  label: string;
  visible: boolean;
  /** Position in grid (row, col) */
  order: number;
  /** Grid span: 1 = half width, 2 = full width */
  span: 1 | 2;
}

export interface DashboardLayout {
  widgets: DashboardWidget[];
  updatedAt: string;
}
