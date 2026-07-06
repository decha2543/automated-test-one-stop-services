import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route-level tests for M2 tool-plugin endpoints.
 *
 * Validates: Requirements 6.2–6.5, 6.7, 11.1–11.4, 13.1–13.7
 *
 * Strategy: mock the service layer (`tool-plugins` and `workspace-sync`)
 * entirely, then exercise each route via Fastify's `inject()` method.
 * This validates HTTP status codes, response shapes, SAFE_ID validation,
 * and error envelopes without touching the real filesystem.
 */

// ─── Fake ToolView ───────────────────────────────────────────────────────────

const fakeToolView = {
  id: 'playwright',
  alias: 'pw',
  title: 'Playwright (Web UI / API)',
  description: 'E2E browser + API testing.',
  version: '1.55.0',
  status: 'enabled' as const,
  runtime: 'node' as const,
  packageManager: 'pnpm' as const,
  projectCount: 2,
  manifestPath: 'tools/playwright/tool.manifest.json',
  errors: [],
  origin: 'local' as const,
};

const fakeK6View = {
  id: 'k6',
  alias: 'k6',
  title: 'k6 Performance',
  description: 'Load testing.',
  version: '0.50.0',
  status: 'disabled' as const,
  runtime: 'node' as const,
  packageManager: 'pnpm' as const,
  projectCount: 1,
  manifestPath: 'tools/k6/tool.manifest.json',
  errors: [],
  origin: 'local' as const,
};

// ─── Service mocks ───────────────────────────────────────────────────────────

const mockListToolViews = vi.fn(async () => [fakeToolView, fakeK6View]);
const mockSetEnabled = vi.fn(async (id: string, enabled: boolean, _scope: string) => ({
  result: { ...fakeToolView, id, status: enabled ? 'enabled' : 'disabled' },
  resynced: false,
  regeneratedFiles: [] as string[],
}));
const mockRefreshAndCount = vi.fn(async () => ({
  enabled: 2,
  disabled: 1,
  invalid: 0,
}));
const mockSyncWorkspaceInProcess = vi.fn(
  async (): Promise<{
    resynced: boolean;
    regeneratedFiles: string[];
    resyncError?: { code: string; message: string };
  }> => ({
    resynced: true,
    regeneratedFiles: ['pipeline.json', 'tools/playwright/docker-compose.yml'],
  }),
);
const mockWithResync = vi.fn(async (doMutation: () => Promise<unknown>) => {
  const result = await doMutation();
  return {
    result,
    resynced: true,
    regeneratedFiles: ['pipeline.json'],
  };
});

const mockUpdateTool = vi.fn(async (_id: string, _ref?: string) => ({
  ok: true as const,
  lifecycle: {
    result: { from: 'abc1234', to: 'def5678' },
    resynced: true,
    regeneratedFiles: ['pipeline.json'] as string[],
  },
}));

// Post_Install_Hook effects + runner — the provision route reuses these. The
// hook runner returns `undefined` (success) by default; tests override per case.
const mockDefaultPostInstallEffects = vi.fn(() => ({ fake: 'effects' }));
const mockRunPostInstallHook = vi.fn(
  (_id: string, _effects: unknown): { code: string; message: string } | undefined => undefined,
);
const mockInvalidateDoctorCache = vi.fn();

vi.mock('../../services/tool-plugins.js', () => ({
  listToolViews: (...args: unknown[]) =>
    mockListToolViews(...(args as Parameters<typeof mockListToolViews>)),
  setEnabled: (...args: unknown[]) => mockSetEnabled(...(args as [string, boolean, string])),
  refreshAndCount: (...args: unknown[]) =>
    mockRefreshAndCount(...(args as Parameters<typeof mockRefreshAndCount>)),
  updateTool: (...args: unknown[]) => mockUpdateTool(...(args as [string, string | undefined])),
  runPostInstallHook: (...args: unknown[]) =>
    mockRunPostInstallHook(...(args as [string, unknown])),
  defaultPostInstallEffects: (...args: unknown[]) =>
    mockDefaultPostInstallEffects(...(args as [])),
}));

vi.mock('../../services/doctor.js', () => ({
  invalidateDoctorCache: (...args: unknown[]) => mockInvalidateDoctorCache(...(args as [])),
}));

vi.mock('../../services/workspace-sync.js', () => ({
  syncWorkspaceInProcess: (...args: unknown[]) =>
    mockSyncWorkspaceInProcess(...(args as Parameters<typeof mockSyncWorkspaceInProcess>)),
  withResync: (fn: () => Promise<unknown>) => mockWithResync(fn),
}));

// ─── Test setup ──────────────────────────────────────────────────────────────

describe('tools routes (M2 endpoints)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    const { toolPluginRoutes } = await import('../tools.js');
    await app.register(toolPluginRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ─── GET /api/tools ──────────────────────────────────────────────────────

  describe('GET /api/tools', () => {
    it('returns 200 with array of ToolView', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/tools' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(2);
      expect(body[0]).toMatchObject({
        id: 'playwright',
        alias: 'pw',
        status: 'enabled',
      });
    });

    it('calls listToolViews service', async () => {
      await app.inject({ method: 'GET', url: '/api/tools' });
      expect(mockListToolViews).toHaveBeenCalledOnce();
    });
  });

  // ─── GET /api/tools/:id ──────────────────────────────────────────────────

  describe('GET /api/tools/:id', () => {
    it('returns 200 with a single ToolView for valid id', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/tools/playwright' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe('playwright');
      expect(body.alias).toBe('pw');
      expect(body.title).toBe('Playwright (Web UI / API)');
    });

    it('returns 400 INVALID_TOOL_NAME for unsafe id pattern', async () => {
      // Fastify normalizes `../` in paths before routing, so test with dot-prefixed name
      const res = await app.inject({ method: 'GET', url: '/api/tools/.hidden-dir' });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('INVALID_TOOL_NAME');
    });

    it('returns 400 INVALID_TOOL_NAME for id starting with number', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/tools/123tool' });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('INVALID_TOOL_NAME');
    });

    it('returns 400 INVALID_TOOL_NAME for id with uppercase', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/tools/MyTool' });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('INVALID_TOOL_NAME');
    });

    it('returns 400 INVALID_TOOL_NAME for id with special chars', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/tools/tool_name' });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('INVALID_TOOL_NAME');
    });

    it('returns 404 MANIFEST_NOT_FOUND for unknown valid id', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/tools/nonexistent-tool' });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.code).toBe('MANIFEST_NOT_FOUND');
    });
  });

  // ─── POST /api/tools/:id/enable ──────────────────────────────────────────

  describe('POST /api/tools/:id/enable', () => {
    it('returns 200 with LifecycleResult on valid id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/tools/playwright/enable',
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('result');
      expect(body).toHaveProperty('resynced');
      expect(body).toHaveProperty('regeneratedFiles');
    });

    it('passes scope=local by default', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/tools/playwright/enable',
        payload: {},
      });

      expect(mockSetEnabled).toHaveBeenCalledWith('playwright', true, 'local');
    });

    it('passes scope=local when specified in body', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/tools/k6/enable',
        payload: { scope: 'local' },
      });

      expect(mockSetEnabled).toHaveBeenCalledWith('k6', true, 'local');
    });

    it('returns 400 INVALID_TOOL_NAME for unsafe id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/tools/BAD-ID/enable',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_TOOL_NAME');
    });
  });

  // ─── POST /api/tools/:id/disable ─────────────────────────────────────────

  describe('POST /api/tools/:id/disable', () => {
    it('returns 200 with LifecycleResult on valid id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/tools/playwright/disable',
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('result');
      expect(body).toHaveProperty('resynced');
      expect(body).toHaveProperty('regeneratedFiles');
    });

    it('calls setEnabled with enabled=false and default local scope', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/tools/k6/disable',
        payload: {},
      });

      expect(mockSetEnabled).toHaveBeenCalledWith('k6', false, 'local');
    });

    it('supports scope=local in body', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/tools/playwright/disable',
        payload: { scope: 'local' },
      });

      expect(mockSetEnabled).toHaveBeenCalledWith('playwright', false, 'local');
    });

    it('returns 400 INVALID_TOOL_NAME for unsafe id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/tools/NOT-valid/disable',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_TOOL_NAME');
    });
  });

  // ─── POST /api/tools/refresh ─────────────────────────────────────────────

  describe('POST /api/tools/refresh', () => {
    it('returns 200 with refreshed counts', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/tools/refresh' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('refreshed');
      expect(body.refreshed).toEqual({
        enabled: 2,
        disabled: 1,
        invalid: 0,
      });
    });

    it('calls refreshAndCount service', async () => {
      await app.inject({ method: 'POST', url: '/api/tools/refresh' });
      expect(mockRefreshAndCount).toHaveBeenCalledOnce();
    });
  });

  // ─── POST /api/workspace/resync ──────────────────────────────────────────

  describe('POST /api/workspace/resync', () => {
    it('returns 200 with resync result on success', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/workspace/resync' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('resynced', true);
      expect(body).toHaveProperty('regeneratedFiles');
      expect(body.regeneratedFiles).toContain('pipeline.json');
    });

    it('calls syncWorkspaceInProcess service', async () => {
      await app.inject({ method: 'POST', url: '/api/workspace/resync' });
      expect(mockSyncWorkspaceInProcess).toHaveBeenCalledOnce();
    });

    it('returns resyncError when sync fails', async () => {
      mockSyncWorkspaceInProcess.mockResolvedValueOnce({
        resynced: false,
        regeneratedFiles: [],
        resyncError: { code: 'RESYNC_FAILED', message: 'Template missing' },
      });

      const res = await app.inject({ method: 'POST', url: '/api/workspace/resync' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.resynced).toBe(false);
      expect(body.resyncError).toEqual({
        code: 'RESYNC_FAILED',
        message: 'Template missing',
      });
    });
  });

  // ─── POST /api/tools/:id/update (ref injection guard) ────────────────────

  describe('POST /api/tools/:id/update — ref validation (SAFE_GIT_REF)', () => {
    const unsafeRefs = [
      'main; rm -rf /', // command chaining
      '$(whoami)', // command substitution
      '`id`', // backtick substitution
      'a|b', // pipe
      'a && b', // logical-and
      'has space', // whitespace
      '--upload-pack=evil', // git option injection
      '-x', // leading hyphen
      'feat/..\\evil', // parent-traversal sequence
      'v1..v2', // double-dot
    ];

    for (const ref of unsafeRefs) {
      it(`rejects ref=${JSON.stringify(ref)} with 400 INVALID_REF and never calls the service`, async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/tools/playwright/update',
          payload: { ref },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('INVALID_REF');
        expect(mockUpdateTool).not.toHaveBeenCalled();
      });
    }

    it('accepts a safe ref and forwards it to updateTool', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/tools/playwright/update',
        payload: { ref: 'release/1.2.x' },
      });
      expect(res.statusCode).toBe(200);
      expect(mockUpdateTool).toHaveBeenCalledWith('playwright', 'release/1.2.x');
    });

    it('allows an omitted ref (service resolves the default branch)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/tools/playwright/update',
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(mockUpdateTool).toHaveBeenCalledWith('playwright', undefined);
    });

    it('still rejects an unsafe id before checking ref', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/tools/BAD-ID/update',
        payload: { ref: 'main' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_TOOL_NAME');
      expect(mockUpdateTool).not.toHaveBeenCalled();
    });
  });

  // ─── POST /api/tools/:id/provision ───────────────────────────────────────

  describe('POST /api/tools/:id/provision', () => {
    it('returns 200 { ok: true } and runs the hook for a valid id', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/tools/playwright/provision' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(mockRunPostInstallHook).toHaveBeenCalledWith('playwright', { fake: 'effects' });
      expect(mockInvalidateDoctorCache).toHaveBeenCalledOnce();
    });

    it('returns 200 { ok: false, postInstallError } when the hook fails', async () => {
      mockRunPostInstallHook.mockReturnValueOnce({
        code: 'POST_INSTALL_FAILED',
        message: "Tool 'playwright' Post_Install_Hook failed: browser download failed",
      });

      const res = await app.inject({ method: 'POST', url: '/api/tools/playwright/provision' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(false);
      expect(body.postInstallError).toEqual({
        code: 'POST_INSTALL_FAILED',
        message: "Tool 'playwright' Post_Install_Hook failed: browser download failed",
      });
    });

    it('rejects an unsafe id with 400 and performs NO side effect', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/tools/BAD-ID/provision' });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_TOOL_NAME');
      // No hook run and no cache invalidation before the validation gate.
      expect(mockRunPostInstallHook).not.toHaveBeenCalled();
      expect(mockInvalidateDoctorCache).not.toHaveBeenCalled();
    });
  });

  // ─── SAFE_ID validation (cross-cutting) ──────────────────────────────────

  describe('SAFE_ID validation across endpoints', () => {
    const unsafeIds = [
      '.hidden',
      '123abc',
      'UPPERCASE',
      'has_underscore',
      'has%20space',
      'has.dot',
      'a', // single char — regex requires 2+ chars: /^[a-z][a-z0-9-]+$/
    ];

    for (const id of unsafeIds) {
      it(`rejects id="${id}" with 400 on GET /api/tools/:id`, async () => {
        const encodedId = encodeURIComponent(id);
        const res = await app.inject({ method: 'GET', url: `/api/tools/${encodedId}` });
        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('INVALID_TOOL_NAME');
      });
    }

    const validIds = ['playwright', 'robot-framework', 'k6', 'my-new-tool', 'tool123'];

    for (const id of validIds) {
      it(`accepts id="${id}" on GET /api/tools/:id (may 404)`, async () => {
        const res = await app.inject({ method: 'GET', url: `/api/tools/${id}` });
        // Should not be 400 — either 200 (found) or 404 (not found)
        expect(res.statusCode).not.toBe(400);
      });
    }
  });
});
