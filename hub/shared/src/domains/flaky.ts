import type { RunStatus } from './runs.js';
import type { ToolId } from './tools.js';

export interface FlakyTestEntry {
  testId: string;
  project: string;
  tool: ToolId;
  type: string;
  totalRuns: number;
  passes: number;
  failures: number;
  flakinessScore: number;
  recentStatuses: RunStatus[];
  lastSeen: string;
  isFlaky: boolean;
}

export interface FlakyReport {
  generatedAt: string;
  totalTests: number;
  flakyTests: FlakyTestEntry[];
  stabilizedTests: FlakyTestEntry[];
}
