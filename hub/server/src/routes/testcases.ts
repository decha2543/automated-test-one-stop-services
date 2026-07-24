import fs from 'node:fs';
import path from 'node:path';
import type { TestCaseStatusSyncResult } from '@hub/shared';
import type { FastifyInstance } from 'fastify';
import { TOOLS_DIR } from '../config.js';
import { SAFE_ID } from '../lib/safe-id.js';
import { isUnder } from '../services/path-guard.js';
import { parseRunOutcomes } from '../services/run-compare.js';
import { runner } from '../services/runner.js';
import {
  addTestCaseRow,
  applyRunStatus,
  editTestCaseCell,
  listTestCaseDocs,
  readTestCaseCsv,
  readTestCaseGrid,
  readTestCaseXlsx,
} from '../services/testcases.js';

/** A path segment that cannot traverse (no `..`, no backslash, no leading slash). */
const SAFE_SEGMENT = /^[A-Za-z0-9._/-]+$/;
function safeSegment(value: string | undefined): value is string {
  return !!value && SAFE_SEGMENT.test(value) && !value.includes('..');
}

/** Derive tool/type/project from a doc under tools/<tool>/projects/<type>/<project>/... */
function projectFromDocPath(
  docPath: string,
): { tool: string; type: string; project: string } | null {
  const rel = path.relative(TOOLS_DIR, docPath).split(path.sep);
  if (rel.length < 4 || rel[1] !== 'projects') return null;
  const [tool, , type, project] = rel;
  return tool && type && project ? { tool, type, project } : null;
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

  /** GET /api/testcases/grid?path= — editable grid (prefers the .edited.json overlay). */
  app.get<{ Querystring: { path?: string } }>('/api/testcases/grid', async (req, reply) => {
    const p = req.query.path;
    const lower = p?.toLowerCase() ?? '';
    if (!p || !isUnder(TOOLS_DIR, p) || !(lower.endsWith('.csv') || lower.endsWith('.xlsx'))) {
      reply.status(400);
      return { code: 'INVALID_PATH', message: 'path must be a .csv/.xlsx under tools/' };
    }
    const grid = await readTestCaseGrid(p);
    if (!grid) {
      reply.status(404);
      return { code: 'NOT_FOUND', message: 'doc missing, too large, or unparseable' };
    }
    return grid;
  });

  /** POST /api/testcases/edit — set one cell + auto-stamp Updated At (writes .edited.json). */
  app.post<{ Body: { path?: string; sheet?: number; row?: number; col?: number; value?: string } }>(
    '/api/testcases/edit',
    async (req, reply) => {
      const { path: p, sheet, row, col, value } = req.body ?? {};
      const lower = p?.toLowerCase() ?? '';
      if (!p || !isUnder(TOOLS_DIR, p) || !(lower.endsWith('.csv') || lower.endsWith('.xlsx'))) {
        reply.status(400);
        return { code: 'INVALID_PATH', message: 'path must be a .csv/.xlsx under tools/' };
      }
      if (
        typeof sheet !== 'number' ||
        typeof row !== 'number' ||
        typeof col !== 'number' ||
        typeof value !== 'string'
      ) {
        reply.status(400);
        return {
          code: 'BAD_REQUEST',
          message: 'sheet, row, col (numbers) + value (string) required',
        };
      }
      const grid = await editTestCaseCell(p, sheet, row, col, value);
      if (!grid) {
        reply.status(400);
        return { code: 'EDIT_FAILED', message: 'invalid target cell' };
      }
      return grid;
    },
  );

  /** POST /api/testcases/add-row — append a blank row (writes .edited.json). */
  app.post<{ Body: { path?: string; sheet?: number } }>(
    '/api/testcases/add-row',
    async (req, reply) => {
      const { path: p, sheet } = req.body ?? {};
      const lower = p?.toLowerCase() ?? '';
      if (!p || !isUnder(TOOLS_DIR, p) || !(lower.endsWith('.csv') || lower.endsWith('.xlsx'))) {
        reply.status(400);
        return { code: 'INVALID_PATH', message: 'path must be a .csv/.xlsx under tools/' };
      }
      const grid = await addTestCaseRow(p, typeof sheet === 'number' ? sheet : 0);
      if (!grid) {
        reply.status(404);
        return { code: 'NOT_FOUND', message: 'doc not found' };
      }
      return grid;
    },
  );

  /** POST /api/testcases/sync-status — fill Status + Updated At from the project's last run. */
  app.post<{ Body: { path?: string } }>('/api/testcases/sync-status', async (req, reply) => {
    const p = req.body?.path;
    const lower = p?.toLowerCase() ?? '';
    if (!p || !isUnder(TOOLS_DIR, p) || !(lower.endsWith('.csv') || lower.endsWith('.xlsx'))) {
      reply.status(400);
      return { code: 'INVALID_PATH', message: 'path must be a .csv/.xlsx under tools/' };
    }
    const target = projectFromDocPath(p);
    if (!target) {
      reply.status(400);
      return { code: 'INVALID_PATH', message: 'doc is not under a tools/ project' };
    }
    const latest = runner
      .getHistory()
      .filter(
        (r) =>
          r.request.tool === target.tool &&
          r.request.type === target.type &&
          r.request.project === target.project &&
          r.reportPath,
      )
      .sort((a, b) => (b.endedAt ?? b.startedAt).localeCompare(a.endedAt ?? a.startedAt))[0];
    const statusByCaseId: Record<string, 'passed' | 'failed'> = {};
    if (latest) {
      for (const outcome of parseRunOutcomes(latest.reportPath) ?? []) {
        // An outcome maps to its own id (the `${caseId}: ...` title prefix) AND to
        // every doc case it declares coverage for (cover tags shaped `TC-<docId>`).
        const ids = new Set<string>();
        const ownId = outcome.title.split(':')[0]?.trim();
        if (ownId) ids.add(ownId);
        for (const tag of outcome.tags ?? []) if (tag.startsWith('TC-')) ids.add(tag);
        for (const id of ids) statusByCaseId[id] = outcome.status;
      }
    }
    const result = await applyRunStatus(p, statusByCaseId);
    if (!result) {
      reply.status(404);
      return { code: 'NOT_FOUND', message: 'doc missing or unreadable' };
    }
    return {
      ...result,
      runAt: latest?.endedAt ?? latest?.startedAt ?? null,
    } satisfies TestCaseStatusSyncResult;
  });
}

export default testCaseRoutes;
