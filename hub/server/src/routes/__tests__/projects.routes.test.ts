import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route tests for POST /api/projects/clone — focused on the bug where a blank
 * (optional) folder name made the server clone into the existing type dir and
 * fail with a bare 400. The fix derives the folder from the URL and surfaces
 * git's error as `message`.
 *
 * We mock the side-effecting services so no real git/process/fs runs.
 */

interface RunChildResultLike {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  output: string;
}

const mockRunChild =
  vi.fn<(cmd: string, args: string[], opts: unknown) => Promise<RunChildResultLike>>();
vi.mock('../../services/exec.js', () => ({
  runChild: (cmd: string, args: string[], opts: unknown) => mockRunChild(cmd, args, opts),
}));

const mockGetEnabledTools = vi.fn();
vi.mock('../../services/manifest-registry.js', () => ({
  getEnabledTools: () => mockGetEnabledTools(),
}));

vi.mock('../../services/scanner.js', () => ({
  invalidateProjectCache: vi.fn(),
  listAllProjects: vi.fn(async () => []),
  listProjects: vi.fn(async () => []),
  listSections: vi.fn(async () => []),
  listTypes: vi.fn(async () => []),
}));
vi.mock('../../services/project-cleanup.js', () => ({
  removeProjectCascade: vi.fn(async () => ({})),
}));
vi.mock('../../services/workspace-sync.js', () => ({
  withResync: (fn: () => unknown) => fn(),
}));

function execOk(output = ''): RunChildResultLike {
  return { ok: true, code: 0, stdout: output, stderr: '', output };
}
function execFail(output: string, code = 128): RunChildResultLike {
  return { ok: false, code, stdout: '', stderr: output, output };
}

describe('POST /api/projects/clone', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetEnabledTools.mockResolvedValue([{ id: 'playwright' }]);
    mockRunChild.mockResolvedValue(execOk('Cloning into ...'));
    app = Fastify();
    const { projectRoutes } = await import('../projects.js');
    await app.register(projectRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('derives the folder from the URL when name is blank (the bug fix)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/clone',
      payload: { tool: 'playwright', type: 'web', url: 'https://github.com/org/repo.git' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true });
    // Target is the derived subfolder, NOT the bare `…/web` type dir.
    expect(mockRunChild).toHaveBeenCalledWith(
      'git',
      ['clone', 'https://github.com/org/repo.git', 'tools/playwright/projects/web/repo'],
      expect.anything(),
    );
  });

  it('derives from an scp-style git@ URL', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/projects/clone',
      payload: { tool: 'playwright', type: 'web', url: 'git@github.com:org/repo.git' },
    });
    expect(mockRunChild).toHaveBeenCalledWith(
      'git',
      ['clone', 'git@github.com:org/repo.git', 'tools/playwright/projects/web/repo'],
      expect.anything(),
    );
  });

  it('uses the explicit name when provided', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/projects/clone',
      payload: {
        tool: 'playwright',
        type: 'web',
        url: 'https://github.com/org/repo.git',
        name: 'my-proj',
      },
    });
    expect(mockRunChild).toHaveBeenCalledWith(
      'git',
      ['clone', 'https://github.com/org/repo.git', 'tools/playwright/projects/web/my-proj'],
      expect.anything(),
    );
  });

  it('surfaces git output as `message` when the clone fails', async () => {
    mockRunChild.mockResolvedValue(execFail("fatal: repository 'x' not found"));
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/clone',
      payload: { tool: 'playwright', type: 'web', url: 'https://github.com/org/repo.git', name: 'p' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('CLONE_FAILED');
    expect(body.message).toContain('not found');
  });

  it('rejects a malformed URL with 400 INVALID_URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/clone',
      payload: { tool: 'playwright', type: 'web', url: 'not-a-url', name: 'p' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_URL');
    expect(mockRunChild).not.toHaveBeenCalled();
  });
});

describe('POST /api/projects/create', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetEnabledTools.mockResolvedValue([{ id: 'playwright' }]);
    mockRunChild.mockResolvedValue(execOk('created'));
    app = Fastify();
    const { projectRoutes } = await import('../projects.js');
    await app.register(projectRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('surfaces the task output as `message` when create fails', async () => {
    mockRunChild.mockResolvedValue(execFail('task: create-project: template not found'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/create',
      payload: { tool: 'playwright', type: 'web', name: 'demo' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('CREATE_FAILED');
    expect(body.message).toContain('template not found');
  });

  it('returns success when the task succeeds', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/create',
      payload: { tool: 'playwright', type: 'web', name: 'demo' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true });
  });
});
