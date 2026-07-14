import type { EnvEntry } from '@hub/shared';
import type { FastifyInstance } from 'fastify';
import { listCredentialStatus } from '../services/credentials.js';
import { getScriptsEnv, saveEnvFile } from '../services/env-editor.js';

/**
 * Google Sheet usage-logging readiness + on/off toggle for the Projects page.
 *
 * Readiness is derived (never hand-configured): Google `credentials.json`
 * presence (from the credentials service) + `SPREADSHEET_ID` in scripts/.env.
 * The toggle flips `FORCE_TRACK` in scripts/.env, but REFUSES to turn logging on
 * until it is actually ready — so a non-technical user can't enable a dead
 * feature. Mirrors the graceful, best-effort contract of the logging script
 * (see scripts/third-party/google/google-sheet-usage-log.ts).
 */

interface UsageLoggingStatus {
  /** Google credentials.json has been uploaded. */
  hasCredentials: boolean;
  /** SPREADSHEET_ID is set in scripts/.env. */
  hasSpreadsheetId: boolean;
  /** FORCE_TRACK=true — logging runs without prompting. */
  forceTrack: boolean;
  /** Both prerequisites present — the toggle may be turned on. */
  ready: boolean;
  /** Effective sheet tab name (defaults to "logs"). */
  sheetName: string;
}

/** Trimmed value of an env key from the scripts/.env entries, or ''. */
function envValue(entries: EnvEntry[], key: string): string {
  return entries.find((e) => e.key === key)?.value?.trim() ?? '';
}

function computeStatus(): UsageLoggingStatus {
  const hasCredentials = listCredentialStatus().some(
    (t) => t.tool === 'google' && t.hasCredentials,
  );
  const { entries } = getScriptsEnv();
  const hasSpreadsheetId = envValue(entries, 'SPREADSHEET_ID').length > 0;
  const forceTrack = envValue(entries, 'FORCE_TRACK').toLowerCase() === 'true';
  return {
    hasCredentials,
    hasSpreadsheetId,
    forceTrack,
    ready: hasCredentials && hasSpreadsheetId,
    sheetName: envValue(entries, 'SHEET_NAME') || 'logs',
  };
}

export async function usageLoggingRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/usage-logging/status — derived readiness + current on/off state. */
  app.get('/api/usage-logging/status', async () => computeStatus());

  /** POST /api/usage-logging/enabled { enabled } — flip FORCE_TRACK (guarded). */
  app.post<{ Body: { enabled?: boolean } }>('/api/usage-logging/enabled', async (req, reply) => {
    const enabled = req.body?.enabled === true;
    const status = computeStatus();

    // Guard: never enable a feature that can't work — tell the user what's missing.
    if (enabled && !status.ready) {
      reply.status(400);
      return {
        code: 'NOT_READY',
        message: status.hasCredentials
          ? 'Set SPREADSHEET_ID in scripts/.env before enabling usage logging.'
          : 'Upload Google credentials.json before enabling usage logging.',
      };
    }

    // Persist FORCE_TRACK into scripts/.env, preserving the real entries and
    // NOT materializing blank template-only keys (filter fromTemplate).
    const base = getScriptsEnv().entries.filter((e) => !e.fromTemplate);
    const value = enabled ? 'true' : 'false';
    const next = base.some((e) => e.key === 'FORCE_TRACK')
      ? base.map((e) => (e.key === 'FORCE_TRACK' ? { ...e, value } : e))
      : [...base, { key: 'FORCE_TRACK', value, fromTemplate: false }];
    saveEnvFile('scripts', '', '', next);

    return computeStatus();
  });
}

export default usageLoggingRoutes;
