import type {
  LifecycleResult,
  ManifestPreview,
  ProvisionResult,
  ToolRegistryView,
  ToolView,
} from '@hub/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/api/client.js';

/**
 * Every query whose results depend on WHICH tools are enabled/installed.
 * Enabling/disabling/installing/uninstalling a tool changes what these
 * endpoints return, so they must all be invalidated together — otherwise a
 * page like Reports or Artifacts keeps showing a now-disabled tool's data
 * until the user manually refreshes.
 */
const TOOL_DEPENDENT_KEYS: readonly (readonly string[])[] = [
  ['tools'],
  ['projects'],
  ['reports'],
  ['artifacts'],
  ['runs-history'],
  ['runs-last-status'],
  ['bookmarks'],
  ['schedules'],
  ['webhooks'],
  ['env-profiles'],
];

/**
 * Invalidate every tool-dependent query. Active queries (the current page)
 * refetch immediately; inactive ones are marked stale and refetch the next
 * time their page is opened — so switching menus always shows fresh data.
 */
function invalidateToolDependent(qc: QueryClient): void {
  for (const key of TOOL_DEPENDENT_KEYS) {
    qc.invalidateQueries({ queryKey: key });
  }
}

/** Fetches the list of discovered tools (GET /api/tools). */
export function useTools() {
  return useQuery({
    queryKey: ['tools'],
    queryFn: () => api.get<readonly ToolView[]>('/api/tools'),
    staleTime: 15_000,
  });
}

/**
 * Select-ready options ({ value, label }) derived from the installed+enabled
 * tools. Replaces the hardcoded `[{ value: 'playwright', ... }]` lists that were
 * scattered across filter/config pages so the UI always reflects what is
 * actually installed.
 */
export function useToolOptions(): { value: string; label: string }[] {
  const { data } = useTools();
  return (data ?? [])
    .filter((t) => t.status === 'enabled')
    .map((t) => ({ value: t.id, label: t.title }));
}

/** Mutation to toggle a tool's enabled state (POST /api/tools/:id/enable or /disable). */
export function useToggleTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.post<LifecycleResult<ToolView>>(`/api/tools/${id}/${enabled ? 'enable' : 'disable'}`),
    onSuccess: () => invalidateToolDependent(qc),
  });
}

/** Fetches registry entries for the marketplace view (M3).
 *  Pass `enabled` (e.g. the modal's open state) so the registry — which probes
 *  remote git URLs server-side — is only fetched when actually needed, not on
 *  every Projects page load. */
export function useRegistry(enabled = true) {
  return useQuery({
    queryKey: ['tool-registry'],
    queryFn: () => api.get<ToolRegistryView>('/api/tool-registry'),
    staleTime: 60_000,
    enabled,
  });
}

/** Two-phase install: step 1 (dry-run) returns ManifestPreview. */
export function useInstallTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post<ManifestPreview>('/api/tools/install', { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tool-registry'] });
    },
  });
}

/** Two-phase install: step 2 (confirmed) returns LifecycleResult<ToolView>. */
export function useConfirmInstall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.post<LifecycleResult<ToolView>>('/api/tools/install', { name, confirm: true }),
    onSuccess: () => {
      invalidateToolDependent(qc);
      qc.invalidateQueries({ queryKey: ['tool-registry'] });
    },
  });
}

/** Uninstall a tool (project-count guard enforced server-side). */
export function useUninstallTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<LifecycleResult<{ removed: string }>>(`/api/tools/${id}/uninstall`),
    onSuccess: () => invalidateToolDependent(qc),
  });
}

/** Update a registry-installed tool to a new ref. */
export function useUpdateTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ref }: { id: string; ref?: string }) =>
      api.post<LifecycleResult<{ from: string; to: string }>>(`/api/tools/${id}/update`, { ref }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tools'] });
    },
  });
}

/**
 * (Re-)provision a tool's browsers/binary by re-running its `setup` task
 * (POST /api/tools/:id/provision). Mirrors `useToggleTool`'s mutation pattern.
 * On success, invalidates the doctor + tools queries so the Environment Status
 * panel re-probes and reflects the freshly provisioned state. The mutation
 * always resolves (even when provisioning failed in-band: `{ ok: false,
 * postInstallError }`); callers read `data.ok` / `data.postInstallError` to
 * render guidance.
 */
export function useProvisionTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<ProvisionResult>(`/api/tools/${id}/provision`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor'] });
      qc.invalidateQueries({ queryKey: ['tools'] });
    },
  });
}

/** Manually trigger workspace re-sync (POST /api/workspace/resync). */
export function useResyncWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ regeneratedFiles: string[] }>('/api/workspace/resync'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tools'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}
