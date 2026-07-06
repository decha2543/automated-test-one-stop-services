import type { EnvEntry, ToolId } from '@hub/shared';
import type { FastifyInstance } from 'fastify';
import { getProjectEnv, getScriptsEnv, saveEnvFile } from '../services/env-editor.js';
import { getEnabledTools } from '../services/manifest-registry.js';
import { invalidateProjectCache } from '../services/scanner.js';

export async function envRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/env/project?tool=playwright&type=web&project=example */
  app.get<{ Querystring: { tool: ToolId; type: string; project: string } }>(
    '/api/env/project',
    async (req) => {
      return getProjectEnv(req.query.tool, req.query.type, req.query.project);
    },
  );

  /** GET /api/env/scripts — get scripts/.env */
  app.get('/api/env/scripts', async () => {
    return getScriptsEnv();
  });

  /** PUT /api/env/project — save project .env */
  app.put<{ Body: { tool: ToolId; type: string; project: string; entries: EnvEntry[] } }>(
    '/api/env/project',
    async (req, reply) => {
      const { tool, type, project, entries } = req.body;
      const manifest = (await getEnabledTools()).find((t) => t.id === tool);
      if (!manifest) {
        reply.status(404);
        return {
          code: 'TOOL_NOT_FOUND',
          message: `Tool '${tool}' is not installed or not enabled`,
        };
      }
      saveEnvFile(tool, type, project, entries);
      // Env-readiness badge (ready / env missing) is derived from the cached
      // project scan; drop the cache so the client's ['projects'] refetch sees
      // fresh status instead of waiting out the 30s TTL.
      invalidateProjectCache();
      return { success: true };
    },
  );

  /** PUT /api/env/scripts — save scripts/.env */
  app.put<{ Body: { entries: EnvEntry[] } }>('/api/env/scripts', async (req) => {
    saveEnvFile('scripts', '', '', req.body.entries);
    return { success: true };
  });

  /** GET /api/env/template?tool=playwright&type=web&project=example — get template entries only */
  app.get<{ Querystring: { tool: ToolId; type: string; project: string } }>(
    '/api/env/template',
    async (req, reply) => {
      const { getTemplateEntries } = await import('../services/env-editor.js');
      const entries = getTemplateEntries(req.query.tool, req.query.type, req.query.project);
      if (!entries) {
        reply.status(404);
        return { code: 'NOT_FOUND', message: 'No .env.template found' };
      }
      return { entries };
    },
  );
}

export default envRoutes;
