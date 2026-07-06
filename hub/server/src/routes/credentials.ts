import type { FastifyInstance } from 'fastify';
import { listCredentialStatus, saveCredentials } from '../services/credentials.js';

/**
 * Third-party credential management. Lists which `scripts/third-party/<tool>/`
 * integrations are missing their `credentials.json` and accepts uploads to
 * fill them in. Used by the scripts/.env card on the Projects page.
 */
export async function credentialsRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/credentials — credential presence per third-party tool. */
  app.get('/api/credentials', async () => {
    return { tools: listCredentialStatus() };
  });

  /** POST /api/credentials/:tool — upload a tool's credentials.json. */
  app.post<{ Params: { tool: string }; Body: { content?: string } }>(
    '/api/credentials/:tool',
    async (req, reply) => {
      const content = req.body?.content;
      if (typeof content !== 'string' || content.trim().length === 0) {
        reply.status(400);
        return { code: 'EMPTY_CONTENT', message: 'no file content provided' };
      }
      const result = saveCredentials(req.params.tool, content);
      if (!result.ok) {
        reply.status(result.code === 'NO_CREDENTIALS_DIR' ? 404 : 400);
        return result;
      }
      return { success: true, path: result.path };
    },
  );
}

export default credentialsRoutes;
