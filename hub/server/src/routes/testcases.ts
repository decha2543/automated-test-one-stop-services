import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { TOOLS_DIR } from '../config.js';
import { SAFE_ID } from '../lib/safe-id.js';
import { isUnder } from '../services/path-guard.js';
import { listTestCaseDocs, readTestCaseCsv, readTestCaseXlsx } from '../services/testcases.js';

/** A path segment that cannot traverse (no `..`, no backslash, no leading slash). */
const SAFE_SEGMENT = /^[A-Za-z0-9._/-]+$/;
function safeSegment(value: string | undefined): value is string {
  return !!value && SAFE_SEGMENT.test(value) && !value.includes('..');
}

/**
 * Test-case document routes. Surfaces the test-case docs (xlsx/csv) that the QA
 * pipeline writes under a project's own folder — read-only, and strictly guarded
 * to `tools/` so a crafted `path` can never escape the workspace tools tree.
 */
export async function testCaseRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/testcases?tool=&type=&project= — list test-case docs for a project. */
  app.get<{ Querystring: { tool?: string; type?: string; project?: string } }>(
    '/api/testcases',
    async (req, reply) => {
      const { tool, type, project } = req.query;
      if (!tool || !SAFE_ID.test(tool) || !safeSegment(type) || !safeSegment(project)) {
        reply.status(400);
        return { code: 'BAD_REQUEST', message: 'tool, type and project are required and safe' };
      }
      const projectDir = path.join(TOOLS_DIR, tool, 'projects', type, project);
      if (!isUnder(TOOLS_DIR, projectDir)) {
        reply.status(400);
        return { code: 'INVALID_PATH', message: 'resolved path escapes tools/' };
      }
      return listTestCaseDocs(projectDir);
    },
  );

  /** GET /api/testcases/csv?path= — parsed CSV preview (guarded to tools/). */
  app.get<{ Querystring: { path?: string } }>('/api/testcases/csv', async (req, reply) => {
    const p = req.query.path;
    if (!p || !isUnder(TOOLS_DIR, p) || !p.toLowerCase().endsWith('.csv')) {
      reply.status(400);
      return { code: 'INVALID_PATH', message: 'path must be a .csv under tools/' };
    }
    const csv = readTestCaseCsv(p);
    if (!csv) {
      reply.status(404);
      return { code: 'NOT_FOUND', message: 'CSV missing, too large, or unparseable' };
    }
    return csv;
  });

  /** GET /api/testcases/xlsx?path= — parsed workbook preview (guarded to tools/). */
  app.get<{ Querystring: { path?: string } }>('/api/testcases/xlsx', async (req, reply) => {
    const p = req.query.path;
    if (!p || !isUnder(TOOLS_DIR, p) || !p.toLowerCase().endsWith('.xlsx')) {
      reply.status(400);
      return { code: 'INVALID_PATH', message: 'path must be a .xlsx under tools/' };
    }
    const workbook = await readTestCaseXlsx(p);
    if (!workbook) {
      reply.status(404);
      return { code: 'NOT_FOUND', message: 'workbook missing, too large, or unparseable' };
    }
    return workbook;
  });

  /** GET /api/testcases/download?path= — stream a test-case doc (guarded to tools/). */
  app.get<{ Querystring: { path?: string } }>('/api/testcases/download', async (req, reply) => {
    const p = req.query.path;
    const lower = p?.toLowerCase() ?? '';
    if (!p || !isUnder(TOOLS_DIR, p) || !(lower.endsWith('.csv') || lower.endsWith('.xlsx'))) {
      reply.status(400);
      return { code: 'INVALID_PATH', message: 'path must be a .csv/.xlsx under tools/' };
    }
    if (!fs.existsSync(p)) {
      reply.status(404);
      return { code: 'NOT_FOUND', message: 'File not found' };
    }
    reply.header('Content-Disposition', `attachment; filename="${path.basename(p)}"`);
    reply.type('application/octet-stream');
    return reply.send(fs.createReadStream(p));
  });
}

export default testCaseRoutes;
