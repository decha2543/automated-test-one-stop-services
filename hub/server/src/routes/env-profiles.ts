import type { EnvProfile, ToolId } from '@hub/shared';
import type { FastifyInstance } from 'fastify';
import { envProfileService } from '../services/env-profiles.js';

export async function envProfileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/env-profiles', async () => {
    return envProfileService.getAll();
  });

  app.get<{ Querystring: { tool: ToolId; type: string; project: string } }>(
    '/api/env-profiles/by-project',
    async (req) => {
      return envProfileService.getByProject(req.query.tool, req.query.type, req.query.project);
    },
  );

  app.post<{ Body: Omit<EnvProfile, 'id' | 'createdAt' | 'updatedAt'> }>(
    '/api/env-profiles',
    async (req) => {
      return envProfileService.create(req.body);
    },
  );

  app.put<{ Params: { id: string }; Body: Partial<EnvProfile> }>(
    '/api/env-profiles/:id',
    async (req, reply) => {
      const result = envProfileService.update(req.params.id, req.body);
      if (!result) {
        reply.status(404);
        return { code: 'NOT_FOUND', message: 'Profile not found' };
      }
      return result;
    },
  );

  app.delete<{ Params: { id: string } }>('/api/env-profiles/:id', async (req, reply) => {
    const ok = envProfileService.delete(req.params.id);
    if (!ok) {
      reply.status(404);
      return { code: 'NOT_FOUND', message: 'Profile not found' };
    }
    return { success: true };
  });

  app.post<{ Params: { id: string } }>('/api/env-profiles/:id/apply', async (req, reply) => {
    const result = envProfileService.apply(req.params.id);
    if (!result.success) {
      reply.status(400);
      return { code: 'APPLY_FAILED', message: result.error };
    }
    return { success: true };
  });

  app.post<{
    Body: { tool: ToolId; type: string; project: string; name: string; environment: string };
  }>('/api/env-profiles/capture', async (req, reply) => {
    const { tool, type, project, name, environment } = req.body;
    const result = envProfileService.captureFromEnv(tool, type, project, name, environment);
    if (!result) {
      reply.status(404);
      return { code: 'NOT_FOUND', message: 'Project .env not found' };
    }
    return result;
  });

  app.get<{ Querystring: { tool: ToolId; type: string; project: string } }>(
    '/api/env-profiles/active',
    async (req) => {
      const activeId = envProfileService.getActiveProfile(
        req.query.tool,
        req.query.type,
        req.query.project,
      );
      return { activeId };
    },
  );

  app.get<{ Querystring: { tool: ToolId; type: string; project: string } }>(
    '/api/env-profiles/template',
    async (req) => {
      return envProfileService.getTemplate(req.query.tool, req.query.type, req.query.project);
    },
  );
}

export default envProfileRoutes;
