import type { HubExportPayload } from '@hub/shared';
import type { FastifyInstance } from 'fastify';
import { envProfileService } from '../services/env-profiles.js';
import { loadJson, saveJson } from '../services/persistence.js';
import { webhookService } from '../services/webhooks.js';

export async function exportImportRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { include?: string } }>('/api/export', async (req) => {
    const include = req.query.include?.split(',') ?? [
      'bookmarks',
      'schedules',
      'webhooks',
      'envProfiles',
    ];

    const payload: HubExportPayload = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
    };

    if (include.includes('bookmarks')) {
      payload.bookmarks = loadJson('bookmarks.json', []);
    }
    if (include.includes('schedules')) {
      payload.schedules = loadJson('schedules.json', []);
    }
    if (include.includes('webhooks')) {
      payload.webhooks = webhookService.getAll();
    }
    if (include.includes('envProfiles')) {
      payload.envProfiles = envProfileService.getAll();
    }

    return payload;
  });

  app.post<{ Body: HubExportPayload & { merge?: boolean } }>('/api/import', async (req, reply) => {
    const { bookmarks, schedules, webhooks, envProfiles, merge } = req.body;

    if (!req.body.version) {
      reply.status(400);
      return { code: 'INVALID_PAYLOAD', message: 'Missing version field' };
    }

    const results: Record<string, number> = {};

    if (bookmarks) {
      if (merge) {
        const existing = loadJson<unknown[]>('bookmarks.json', []);
        saveJson('bookmarks.json', [...existing, ...bookmarks]);
      } else {
        saveJson('bookmarks.json', bookmarks);
      }
      results.bookmarks = bookmarks.length;
    }

    if (schedules) {
      if (merge) {
        const existing = loadJson<unknown[]>('schedules.json', []);
        saveJson('schedules.json', [...existing, ...schedules]);
      } else {
        saveJson('schedules.json', schedules);
      }
      results.schedules = schedules.length;
    }

    if (webhooks) {
      if (merge) {
        const existing = webhookService.getAll();
        saveJson('webhooks.json', [...existing, ...webhooks]);
      } else {
        saveJson('webhooks.json', webhooks);
      }
      results.webhooks = webhooks.length;
    }

    if (envProfiles) {
      if (merge) {
        const existing = envProfileService.getAll();
        saveJson('env-profiles.json', [...existing, ...envProfiles]);
      } else {
        saveJson('env-profiles.json', envProfiles);
      }
      results.envProfiles = envProfiles.length;
    }

    return { success: true, imported: results };
  });
}

export default exportImportRoutes;
