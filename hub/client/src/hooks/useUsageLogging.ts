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
