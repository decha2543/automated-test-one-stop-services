import type { FastifyInstance } from 'fastify';
import { k6TrendsService } from '../services/k6-trends.js';

export async function k6TrendRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/k6-trends', async () => {
    return k6TrendsService.getAll();
  });

  app.get<{ Params: { project: string } }>('/api/k6-trends/:project', async (req) => {
    return k6TrendsService.getByProject(req.params.project);
  });

  app.post('/api/k6-trends/refresh', async () => {
    return k6TrendsService.refresh();
  });

  app.post<{ Params: { project: string } }>('/api/k6-trends/:project/refresh', async (req) => {
    return k6TrendsService.refresh(req.params.project);
  });
}

export default k6TrendRoutes;
