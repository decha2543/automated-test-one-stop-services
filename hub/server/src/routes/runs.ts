import fs from 'node:fs';
import path from 'node:path';
import type { RunRequest } from '@hub/shared';
import type { FastifyInstance } from 'fastify';
import { WORKSPACE_ROOT } from '../config.js';
import { buildTaskCommand } from '../services/command-builder.js';
import { getEnabledToolIds } from '../services/manifest-registry.js';
import { runner } from '../services/runner.js';

export async function runRoutes(app: FastifyInstance): Promise<void> {
  /** POST /api/runs — start a new test run */
  app.post<{ Body: RunRequest }>('/api/runs', async (req) => {
    const command = await buildTaskCommand(req.body);
    return runner.start(req.body, command);
  });

  /** GET /api/runs/active — list currently running tests */
  app.get('/api/runs/active', async () => {
    return runner.getActive();
  });

  /** GET /api/runs/:id/output — get buffered output for reconnection */
  app.get<{ Params: { id: string } }>('/api/runs/:id/output', async (req, reply) => {
    const buffer = runner.getOutputBuffer(req.params.id);
    if (buffer === null) {
      reply.status(404);
      return { code: 'NOT_FOUND', message: 'Run not found or already finished' };
    }
    return { output: buffer };
  });

  /** GET /api/runs/history — past runs of ENABLED tools (max 100) */
  app.get('/api/runs/history', async () => {
    const enabledIds = await getEnabledToolIds();
    return runner.getHistory().filter((r) => enabledIds.has(r.request.tool));
  });

  /** GET /api/runs/last-status — last run status per project (enabled tools).
   *  Map keys are `tool/type/project`; drop entries for disabled tools. */
  app.get('/api/runs/last-status', async () => {
    const enabledIds = await getEnabledToolIds();
    const all = runner.getLastStatusByProject();
    return Object.fromEntries(
      Object.entries(all).filter(([key]) => enabledIds.has(key.split('/')[0] ?? '')),
    );
  });

  /** POST /api/runs/:id/cancel — cancel a running or queued test */
  app.post<{ Params: { id: string } }>('/api/runs/:id/cancel', async (req, reply) => {
    // Try cancelling active run first
    const ok = runner.cancel(req.params.id);
    if (ok) return { success: true };
    // Try removing from queue
    const removed = runner.removeFromQueue(req.params.id);
    if (removed) return { success: true };
    reply.status(404);
    return { code: 'NOT_FOUND', message: 'Run not found or already finished' };
  });

  /** GET /api/runs/last-command — get the last-run command for rerun */
  app.get('/api/runs/last-command', async (_req, reply) => {
    const lastRunPath = path.join(WORKSPACE_ROOT, '.last-run');
    if (!fs.existsSync(lastRunPath)) {
      reply.status(404);
      return { code: 'NO_LAST_RUN', message: 'No previous run found. Run a test first.' };
    }
    const command = fs.readFileSync(lastRunPath, 'utf8').trim();
    return { command };
  });

  /** GET /api/runs/concurrency — get current concurrency settings */
  app.get('/api/runs/concurrency', async () => {
    return {
      maxConcurrency: runner.getMaxConcurrency(),
      activeCount: runner.getActive().length,
      queueLength: runner.getQueueLength(),
    };
  });

  /** PUT /api/runs/concurrency — update max concurrency */
  app.put<{ Body: { maxConcurrency: number } }>('/api/runs/concurrency', async (req, reply) => {
    const n = req.body?.maxConcurrency;
    if (typeof n !== 'number' || n < 1) {
      reply.status(400);
      return { code: 'BAD_REQUEST', message: 'maxConcurrency must be >= 1' };
    }
    runner.setMaxConcurrency(n);
    return { maxConcurrency: runner.getMaxConcurrency() };
  });

  /** POST /api/runs/batch — start multiple runs (queued sequentially) */
  app.post<{ Body: { requests: RunRequest[] } }>('/api/runs/batch', async (req, reply) => {
    const requests = req.body?.requests;
    if (!Array.isArray(requests) || requests.length === 0) {
      reply.status(400);
      return { code: 'BAD_REQUEST', message: 'requests array is required' };
    }
    const records = await Promise.all(
      requests.map(async (r) => runner.start(r, await buildTaskCommand(r))),
    );
    return { records };
  });

  /** GET /api/runs/case-history?project=x&tag=@TA-C001 — last 10 runs for a case */
  app.get<{ Querystring: { project: string; tag: string } }>(
    '/api/runs/case-history',
    async (req) => {
      const { project, tag } = req.query;
      // Match a tag literal anywhere in the run's tag expression. Using a
      // word-boundary regex prevents `@TA-C001` from matching `@TA-C0011`,
      // and works for both Robot's space-separated lists and Playwright's
      // regex lookaheads `(?=.*@TA-C001)(?=.*@TA-C002)`.
      const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const tagPattern = new RegExp(`(?:^|[^\\w-])${escaped}(?:$|[^\\w-])`);
      const history = runner.getHistory();
      const matching = history
        .filter((r) => {
          if (r.request.project !== project || !r.request.tag) return false;
          return tagPattern.test(r.request.tag);
        })
        .slice(0, 10)
        .map((r) => ({
          id: r.id,
          status: r.status,
          startedAt: r.startedAt,
          endedAt: r.endedAt,
        }));
      return { tag, project, runs: matching };
    },
  );

  /** DELETE /api/runs/history — clear all run history */
  app.delete('/api/runs/history', async () => {
    runner.clearHistory();
    return { success: true };
  });
}

export default runRoutes;
