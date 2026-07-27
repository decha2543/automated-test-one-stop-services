import type { QueueStatus } from '@hub/shared';
import type { FastifyInstance } from 'fastify';
import { runner } from '../services/runner.js';

export async function queueRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/queue — what is running now and what is waiting.
   *
   * `queued` carries the waiting runs in queue order (index = position) so the
   * UI can name them and act on them; without it the panel could only show a
   * count, which left "move to front" / "remove" unusable.
   */
  app.get('/api/queue', async (): Promise<QueueStatus> => {
    const active = runner.getActive();
    return {
      active,
      queued: runner.getQueue().map((q) => q.record),
      activeCount: active.length,
      queueLength: runner.getQueueLength(),
      maxConcurrency: runner.getMaxConcurrency(),
    };
  });

  /** POST /api/queue/promote/:id — jump one waiting run to the front. */
  app.post<{ Params: { id: string } }>('/api/queue/promote/:id', async (req, reply) => {
    const ok = runner.promoteInQueue(req.params.id);
    if (!ok) {
      reply.status(404);
      return { code: 'NOT_FOUND', message: 'Run not found in queue' };
    }
    return { success: true };
  });

  /** DELETE /api/queue/:id — drop a waiting run before it starts. */
  app.delete<{ Params: { id: string } }>('/api/queue/:id', async (req, reply) => {
    const ok = runner.removeFromQueue(req.params.id);
    if (!ok) {
      reply.status(404);
      return { code: 'NOT_FOUND', message: 'Run not found in queue' };
    }
    return { success: true };
  });
}

export default queueRoutes;
