import type { EnvProfile } from './env.js';
import type { Bookmark } from './runs.js';
import type { ScheduleEntry } from './schedules.js';
import type { WebhookConfig } from './webhooks.js';

export interface HubExportPayload {
  version: string;
  exportedAt: string;
  bookmarks?: Bookmark[];
  schedules?: ScheduleEntry[];
  webhooks?: WebhookConfig[];
  envProfiles?: EnvProfile[];
  preferences?: Record<string, unknown>;
}
