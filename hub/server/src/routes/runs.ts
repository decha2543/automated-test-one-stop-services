import fs from 'node:fs';
import path from 'node:path';
import type { RunRequest } from '@hub/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { WORKSPACE_ROOT } from '../config.js';
import { buildTaskCommand } from '../services/command-builder.js';
import { getEnabledToolIds } from '../services/manifest-registry.js';
import { severityByRun } from '../services/reports.js';
import { runner } from '../services/runner.js';

/**
 * Runtime schema for a run request — replaces the previous unchecked
 * `req.body as RunRequest` cast so a malformed body is rejected with a 400
 * before it reaches command building / spawn. `tool` stays a plain string
 * (the manifest registry validates tool existence downstream); unknown keys
 * are stripped. Mirrors the `RunRequest` interface in @hub/shared.
 */
const runRequestSchema = z.object({
  tool: z.string().min(1),
  type: z.string().min(1),
  project: z.string().min(1),
  mode: z.enum(['local', 'docker']),
  tag: z.string().optional(),
  headless: z.enum(['headless', 'headed']).optional(),
  extraArgs: z.string().optional(),
  noTrack: z.boolean().optional(),
  silent: z.boolean().optional(),
  section: z.string().optional(),
  performanceType: z
    .enum(['TEST_PROTOCOL', 'MINIMAL_LOAD', 'LOAD', 'STRESS', 'ENDURANCE', 'PEAK'])
    .optional(),
});

export async function runRoutes(app: FastifyInstance): Promise<void> {
  /** POST /api/runs — start a new test run */
  app.post<{ Body: RunRequest }>(
    '/api/runs',
    { schema: { body: runRequestSchema } },
    async (req) => {
      const command = await buildTaskCommand(req.body);
      return runner.start(req.body, command);
    },
  );

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
    const records = runner.getHistory().filter((r) => enabledIds.has(r.request.tool));
    // Enrich with the per-severity tally the report service already parsed,
    // matched back to each run (RunRecord has no path to its own results.json).
    const severity = await severityByRun(records);
    if (severity.size === 0) return records;
    return records.map((r) => {
      const sev = severity.get(r.id);
      return sev ? { ...r, severity: sev } : r;
    });
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
  app.post<{ Body: { requests: RunRequest[] } }>(
    '/api/runs/batch',
    { schema: { body: z.object({ requests: z.array(runRequestSchema).min(1) }) } },
    async (req) => {
      const records = await Promise.all(
        req.body.requests.map(async (r) => runner.start(r, await buildTaskCommand(r))),
      );
      return { records };
    },
  );

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
