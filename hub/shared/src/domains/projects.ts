import type { ToolId } from './tools.js';

export interface ProjectId {
  tool: ToolId;
  /** For k6 this is always 'performance'. */
  type: string;
  name: string;
}

export interface ProjectSummary extends ProjectId {
  path: string;
  hasEnv: boolean;
  hasEnvTemplate: boolean;
  /** Keys present in template but missing from .env. */
  missingEnvKeys: string[];
  /** True when project folder is its own git repo. */
  isGitRepo: boolean;
  /** Git remote origin URL (if available). */
  gitRemoteUrl?: string;
}
