import type { ToolId } from '@hub/shared';
import type { FastifyInstance } from 'fastify';
import { flakyDetector } from '../services/flaky-detector.js';

export async function flakyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/flaky', async () => {
    // Re-derive from run history on every read so the parseTagExpr fix applies
    // to existing history and stale entries from older analyze runs never show
    // (analyze fully replaces the persisted report).
    return flakyDetector.analyze();
  });

  app.post('/api/flaky/analyze', async () => {
    return flakyDetector.analyze();
  });

  app.get<{ Querystring: { tool: ToolId; type: string; project: string } }>(
    '/api/flaky/by-project',
    async (req) => {
      return flakyDetector.getByProject(req.query.tool, req.query.type, req.query.project);
    },
  );

  app.post<{ Body: { testKey: string } }>('/api/flaky/dismiss', async (req, reply) => {
    const ok = flakyDetector.dismiss(req.body.testKey);
    if (!ok) {
      reply.status(404);
      return { code: 'NOT_FOUND', message: 'Test entry not found' };
    }
    return { success: true };
  });
}

export default flakyRoutes;
