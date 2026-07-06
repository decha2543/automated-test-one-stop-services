import type { ToolId } from './tools.js';

export type WebhookPlatform = 'slack' | 'discord' | 'teams' | 'line' | 'generic';

export type WebhookEvent =
  | 'run-passed'
  | 'run-failed'
  | 'run-error'
  | 'run-cancelled'
  | 'schedule-triggered';

/**
 * Optional run scope for a webhook. When any field is set, the webhook only
 * fires for runs whose `tool`/`type`/`project` match all set fields.
 * Empty/undefined fields are treated as "any".
 */
export interface WebhookScope {
  tool?: ToolId;
  type?: string;
  project?: string;
}

export interface WebhookConfig {
  id: string;
  name: string;
  platform: WebhookPlatform;
  /** Webhook URL (for LINE, this is ignored — uses LINE Push API). */
  url: string;
  /** LINE: Channel Access Token for Messaging API. */
  token?: string;
  /** LINE: Target userId or groupId to send messages to. */
  recipientId?: string;
  /** Which events trigger this webhook. */
  events: WebhookEvent[];
  /** Optional run scope. If unset/empty, webhook fires for all matching events. */
  scope?: WebhookScope;
  /** @deprecated Use `scope.project`. Kept for backward compatibility. */
  projectFilter?: string[];
  enabled: boolean;
  createdAt: string;
  lastTriggeredAt?: string;
  lastStatus?: 'success' | 'error';
}
