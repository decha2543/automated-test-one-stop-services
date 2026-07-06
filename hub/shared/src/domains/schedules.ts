import type { RunRequest, RunStatus } from './runs.js';

export interface ScheduleEntry {
  id: string;
  name: string;
  cron: string;
  config: RunRequest;
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  /** Outcome of the most recent run; 'pending' while a run is in flight. */
  lastStatus?: RunStatus | 'pending';
  nextRunAt?: string;
}
