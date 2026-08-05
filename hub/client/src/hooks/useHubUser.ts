import type { HubUser, HubUserSaveResult } from '@hub/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/api/client.js';
import { qHubUser } from '~/api/queries.js';

/**
 * The Hub's local identity — the name stamped into "Edited By" on test-case
 * rows. `user` is null until a name has been set, which is what the first-run
 * gate keys on.
 */
export function useHubUser(): { user: HubUser | null; isLoading: boolean } {
  const q = useQuery(qHubUser());
  return { user: q.data?.user ?? null, isLoading: q.isLoading };
}

/**
 * Save (or rename) the identity. A rename rewrites past "Edited By" stamps
 * server-side, so every cached test-case grid is dropped afterwards — otherwise
 * an open editor would keep showing the old name.
 */
export function useSaveHubUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.put<HubUserSaveResult>('/api/user', { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hub-user'] });
      qc.invalidateQueries({ queryKey: ['tc-grid'] });
      qc.invalidateQueries({ queryKey: ['testcases'] });
    },
  });
}
