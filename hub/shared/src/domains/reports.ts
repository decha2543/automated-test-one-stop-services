import type { PerformanceType } from './runs.js';
import type { RunSummary } from './run-summary.js';
import type { ToolId } from './tools.js';

// Reports --------------------------------------------------------------------

export interface ReportEntry {
  id: string;
  tool: ToolId;
  type: string;
  project: string;
  status: 'success' | 'error' | 'unknown';
  reportPath: string;
  timestamp: string;
  locked: boolean;
  /**
   * Test-case counts for the run that produced this report, joined from run
   * history. Absent when no matching run is in history (e.g. an old report
   * whose run has aged out of the capped history).
   */
  summary?: RunSummary;
}

export interface ReportAnnotation {
  id: string;
  reportId: string;
  author: string;
  /** Annotation content (markdown supported). */
  content: string;
  type: 'note' | 'bug' | 'improvement' | 'question';
  createdAt: string;
  updatedAt?: string;
}

// Artifacts ------------------------------------------------------------------

export type ArtifactType =
  | 'screenshot'
  | 'video'
  | 'trace'
  | 'log'
  | 'html'
  | 'json'
  | 'other';

export interface ArtifactEntry {
  id: string;
  name: string;
  type: ArtifactType;
  path: string;
  size: number;
  mimeType: string;
  runId?: string;
  createdAt: string;
}

export interface ArtifactFolder {
  name: string;
  path: string;
  children: (ArtifactFolder | ArtifactEntry)[];
  totalSize: number;
  fileCount: number;
}

// k6 trends ------------------------------------------------------------------

export interface K6MetricPoint {
  timestamp: string;
  rps: number;
  avgResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  errorRate: number;
  vus: number;
}

export interface K6RunSummary {
  runId: string;
  project: string;
  section?: string;
  performanceType?: PerformanceType;
  timestamp: string;
  duration: number;
  metrics: K6MetricPoint[];
  thresholds: { name: string; passed: boolean; value: string }[];
}

export interface K6TrendData {
  project: string;
  runs: K6RunSummary[];
}
