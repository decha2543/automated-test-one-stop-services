import type { ToolId } from './tools.js';

export interface ProjectHealthScore {
  tool: ToolId;
  type: string;
  project: string;
  overallScore: number;
  dimensions: {
    lastRunStatus: number;
    envCompleteness: number;
    recentPassRate: number;
    activity: number;
    gitFreshness: number;
  };
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  lastCalculated: string;
}
