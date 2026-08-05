import type { FastifyInstance } from 'fastify';
import { getHubUser, normalizeUserName, saveHubUser } from '../services/hub-user.js';

/**
 * The Hub's single local user identity — the name that auto-fills "Edited By" on
 * test-case rows. Kept server-side because the server is what stamps the column
 * and what rewrites past stamps when the name changes.
 */
export async function userRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/user — the current identity, or `null` when none has been set yet. */
  app.get('/api/user', async () => ({ user: getHubUser() }));

  /**
   * PUT /api/user — create or rename the identity. A rename also rewrites every
   * "Edited By" cell this user stamped (matched by id, not by name), so past rows
   * never keep a stale name.
   */
  app.put<{ Body: { name?: unknown } }>('/api/user', async (req, reply) => {
    const name = normalizeUserName(req.body?.name);
    if (!name) {
      reply.status(400);
      return { code: 'BAD_REQUEST', message: 'name is required' };
    }
    return saveHubUser(name);
  });
}

export default userRoutes;
