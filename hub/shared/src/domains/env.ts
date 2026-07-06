import type { ToolId } from './tools.js';

// Env editor -----------------------------------------------------------------

export interface EnvFile {
  /** Path relative to workspace root. */
  path: string;
  exists: boolean;
  /** Whether a sibling `.env.template` exists. */
  hasTemplate: boolean;
  entries: EnvEntry[];
  /** Keys present in template but missing from .env. */
  missingKeys: string[];
}

export interface EnvEntry {
  key: string;
  value: string;
  /** True when the entry comes from the template (and has no override). */
  fromTemplate: boolean;
  comment?: string;
}

// Env profiles ---------------------------------------------------------------

export interface EnvProfile {
  id: string;
  name: string;
  /** e.g. 'dev', 'staging', 'prod' */
  environment: string;
  tool: ToolId;
  type: string;
  project: string;
  /** Key-value pairs for this profile */
  entries: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}
