import type { Bookmark, RunRequest } from '@hub/shared';
import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { getEnabledToolIds } from '../services/manifest-registry.js';
import { loadJson, saveJson } from '../services/persistence.js';

const BOOKMARKS_FILE = 'bookmarks.json';

function getBookmarks(): Bookmark[] {
  return loadJson<Bookmark[]>(BOOKMARKS_FILE, []);
}

function setBookmarks(bookmarks: Bookmark[]): void {
  saveJson(BOOKMARKS_FILE, bookmarks);
}

/**
 * Body accepted by `POST /api/bookmarks` — a name plus the run-form config to
 * capture. A bookmark is a plain macro: name + config, nothing else.
 */
interface CreateBookmarkBody {
  name: string;
  config: RunRequest;
}

/**
 * Body accepted by `PUT /api/bookmarks/:id` — a partial update. Either field
 * may be omitted: send `{ name }` to rename, `{ config }` to overwrite the
 * captured run-form config (e.g. after tweaking the form), or both at once.
 */
interface UpdateBookmarkBody {
  name?: string;
  config?: RunRequest;
}

export async function bookmarkRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/bookmarks — list saved configs for ENABLED tools only.
   *  Bookmarks of disabled/uninstalled tools are hidden (non-destructively). */
  app.get('/api/bookmarks', async () => {
    const enabledIds = await getEnabledToolIds();
    return getBookmarks().filter((b) => enabledIds.has(b.config.tool));
  });

  /** POST /api/bookmarks — save a new config */
  app.post<{ Body: CreateBookmarkBody }>('/api/bookmarks', async (req) => {
    const bookmarks = getBookmarks();
    const { name, config } = req.body;

    const bookmark: Bookmark = {
      id: nanoid(8),
      name,
      config,
      createdAt: new Date().toISOString(),
    };

    bookmarks.unshift(bookmark);
    setBookmarks(bookmarks);
    return bookmark;
  });

  /** PUT /api/bookmarks/:id — rename and/or overwrite the captured config.
   *  Partial: only the provided fields change; `createdAt`/`id` are preserved. */
  app.put<{ Params: { id: string }; Body: UpdateBookmarkBody }>(
    '/api/bookmarks/:id',
    async (req, reply) => {
      const bookmarks = getBookmarks();
      const idx = bookmarks.findIndex((b) => b.id === req.params.id);
      if (idx === -1) {
        reply.status(404);
        return { code: 'NOT_FOUND', message: 'Bookmark not found' };
      }

      const existing = bookmarks[idx] as Bookmark;
      const { name, config } = req.body;
      const trimmed = name?.trim();
      const updated: Bookmark = {
        ...existing,
        ...(trimmed ? { name: trimmed } : {}),
        ...(config ? { config } : {}),
      };
      bookmarks[idx] = updated;
      setBookmarks(bookmarks);
      return updated;
    },
  );

  /** DELETE /api/bookmarks/:id — remove a saved config */
  app.delete<{ Params: { id: string } }>('/api/bookmarks/:id', async (req, reply) => {
    const bookmarks = getBookmarks();
    const idx = bookmarks.findIndex((b) => b.id === req.params.id);
    if (idx === -1) {
      reply.status(404);
      return { code: 'NOT_FOUND', message: 'Bookmark not found' };
    }
    bookmarks.splice(idx, 1);
    setBookmarks(bookmarks);
    return { success: true };
  });
}

export default bookmarkRoutes;
