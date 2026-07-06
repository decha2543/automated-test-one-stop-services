import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { WORKSPACE_ROOT } from '../config.js';
import { runDoctor } from '../services/doctor.js';

const CREDENTIALS_DIR = path.join(
  WORKSPACE_ROOT,
  'scripts',
  'third-party',
  'google',
  'credentials',
);

export async function doctorRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/doctor — run environment health checks */
  app.get('/api/doctor', async () => {
    return runDoctor();
  });

  /** POST /api/doctor/upload-credentials — upload Google credentials.json */
  app.post('/api/doctor/upload-credentials', async (req, reply) => {
    const body = req.body as { content?: string; filename?: string };
    if (!body.content) {
      reply.status(400);
      return { code: 'MISSING_CONTENT', message: 'File content is required' };
    }

    if (!fs.existsSync(CREDENTIALS_DIR)) {
      fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
    }

    const targetPath = path.join(CREDENTIALS_DIR, 'credentials.json');
    fs.writeFileSync(targetPath, body.content, 'utf8');

    return { ok: true, path: targetPath };
  });
}

export default doctorRoutes;
