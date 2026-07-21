import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/api/client.js';

/**
 * Google Sheet usage-logging readiness + on/off state (GET
 * /api/usage-logging/status). Readiness is DERIVED (credentials uploaded +
 * SPREADSHEET_ID set) — the user never edits config by hand.
 */
export interface UsageLoggingStatus {
  readonly hasCredentials: boolean;
  readonly hasSpreadsheetId: boolean;
  /** A Google token.json exists — the account has been connected at least once. */
  readonly hasToken: boolean;
  readonly forceTrack: boolean;
  readonly ready: boolean;
  readonly sheetName: string;
}

export function useUsageLogging() {
  return useQuery({
    queryKey: ['usage-logging'],
    queryFn: () => api.get<UsageLoggingStatus>('/api/usage-logging/status'),
    staleTime: 15_000,
  });
}

/**
 * Run the interactive Google OAuth flow (POST /api/usage-logging/authenticate).
 * Opens a browser on the machine running the Hub (local-only) and writes
 * token.json; on success the server auto-enables logging when fully ready.
 */
export function useAuthenticateGoogle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<UsageLoggingStatus>('/api/usage-logging/authenticate', {}),
    onSuccess: () => {
      // Auth can flip FORCE_TRACK + creates token.json — refresh everything
      // derived from usage-logging state (badge, credentials, scripts/.env, config).
      qc.invalidateQueries({ queryKey: ['usage-logging'] });
      qc.invalidateQueries({ queryKey: ['credentials'] });
      qc.invalidateQueries({ queryKey: ['env'] });
      qc.invalidateQueries({ queryKey: ['config'] });
    },
  });
}

/** Turn usage logging on/off (POST /api/usage-logging/enabled). */
export function useSetUsageLogging() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      api.post<UsageLoggingStatus>('/api/usage-logging/enabled', { enabled }),
    onSuccess: () => {
      // The toggle writes FORCE_TRACK into scripts/.env, so refresh everything
      // derived from it: this badge, the scripts/.env editor (['env', …]), and
      // the Run page's /api/config forceTrack (['config']).
      qc.invalidateQueries({ queryKey: ['usage-logging'] });
      qc.invalidateQueries({ queryKey: ['env'] });
      qc.invalidateQueries({ queryKey: ['config'] });
    },
  });
}
