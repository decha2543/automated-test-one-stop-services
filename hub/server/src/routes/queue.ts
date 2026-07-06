import type { FastifyInstance } from 'fastify';
import { runner } from '../services/runner.js';

export async function queueRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/queue', async () => {
    return {
      active: runner.getActive(),
      activeCount: runner.getActive().length,
      queueLength: runner.getQueueLength(),
      maxConcurrency: runner.getMaxConcurrency(),
    };
  });

  app.post<{ Body: { runIds: string[] } }>('/api/queue/reorder', async (req, reply) => {
    const { runIds } = req.body;
    if (!Array.isArray(runIds)) {
      reply.status(400);
      return { code: 'BAD_REQUEST', message: 'runIds array is required' };
    }
    const ok = runner.reorderQueue?.(runIds) ?? false;
    if (!ok) {
      reply.status(400);
      return { code: 'REORDER_FAILED', message: 'Could not reorder queue' };
    }
    return { success: true };
  });

  app.post<{ Params: { id: string } }>('/api/queue/promote/:id', async (req, reply) => {
    const ok = runner.promoteInQueue?.(req.params.id) ?? false;
    if (!ok) {
      reply.status(404);
      return { code: 'NOT_FOUND', message: 'Run not found in queue' };
    }
    return { success: true };
  });

  app.delete<{ Params: { id: string } }>('/api/queue/:id', async (req, reply) => {
    const ok = runner.removeFromQueue?.(req.params.id) ?? false;
    if (!ok) {
      reply.status(404);
      return { code: 'NOT_FOUND', message: 'Run not found in queue' };
    }
    return { success: true };
  });
}

export default queueRoutes;
