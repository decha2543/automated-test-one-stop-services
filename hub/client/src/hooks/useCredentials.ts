import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/api/client.js';

/** Presence of a third-party tool's credentials.json (GET /api/credentials). */
export interface CredentialStatus {
  readonly tool: string;
  readonly hasCredentials: boolean;
}

/** Lists every third-party tool that declares a credentials/ folder. */
export function useCredentials() {
  return useQuery({
    queryKey: ['credentials'],
    queryFn: () => api.get<{ tools: CredentialStatus[] }>('/api/credentials'),
    staleTime: 15_000,
  });
}

/** Uploads a tool's credentials.json (POST /api/credentials/:tool). */
export function useUploadCredentials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tool, content }: { tool: string; content: string }) =>
      api.post<{ success: boolean; path: string }>(`/api/credentials/${tool}`, { content }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credentials'] }),
  });
}
