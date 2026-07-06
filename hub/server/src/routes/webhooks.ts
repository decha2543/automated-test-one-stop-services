import type { WebhookConfig } from '@hub/shared';
import type { FastifyInstance } from 'fastify';
import { webhookService } from '../services/webhooks.js';

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/webhooks', async () => {
    return webhookService.getAll();
  });

  app.post<{ Body: Omit<WebhookConfig, 'id' | 'createdAt' | 'lastTriggeredAt' | 'lastStatus'> }>(
    '/api/webhooks',
    async (req) => {
      return webhookService.create(req.body);
    },
  );

  app.put<{ Params: { id: string }; Body: Partial<WebhookConfig> }>(
    '/api/webhooks/:id',
    async (req, reply) => {
      const result = webhookService.update(req.params.id, req.body);
      if (!result) {
        reply.status(404);
        return { code: 'NOT_FOUND', message: 'Webhook not found' };
      }
      return result;
    },
  );

  app.delete<{ Params: { id: string } }>('/api/webhooks/:id', async (req, reply) => {
    const ok = webhookService.delete(req.params.id);
    if (!ok) {
      reply.status(404);
      return { code: 'NOT_FOUND', message: 'Webhook not found' };
    }
    return { success: true };
  });

  app.post<{ Params: { id: string } }>('/api/webhooks/:id/toggle', async (req, reply) => {
    const result = webhookService.toggle(req.params.id);
    if (!result) {
      reply.status(404);
      return { code: 'NOT_FOUND', message: 'Webhook not found' };
    }
    return result;
  });

  /**
   * POST /api/webhooks/:id/test
   * Optional query params let the UI override the sample run shown in the
   * test notification. When omitted, the webhook's configured scope is used.
   */
  app.post<{
    Params: { id: string };
    Querystring: { tool?: string; type?: string; project?: string };
  }>('/api/webhooks/:id/test', async (req, reply) => {
    const { tool, type, project } = req.query;
    const result = await webhookService.test(req.params.id, { tool, type, project });
    if (!result.success) {
      reply.status(result.error === 'Webhook not found' ? 404 : 502);
    }
    return result;
  });
}

export default webhookRoutes;
