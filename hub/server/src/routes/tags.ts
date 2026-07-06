import fs from 'node:fs';
import path from 'node:path';
import {
  buildTagGroups,
  classifyTag,
  type TagDetail,
  type TagsResponse,
  type TestSummary,
  type ToolId,
} from '@hub/shared';
import type { FastifyInstance } from 'fastify';
import { BASH_PATH, WORKSPACE_ROOT } from '../config.js';
import { buildPlaywrightListCommand, buildTagsCommand } from '../services/command-builder.js';
import { runChild } from '../services/exec.js';
import { getToolCapabilities } from '../services/manifest-registry.js';

// ---------------------------------------------------------------------------
// Classification is owned ENTIRELY by `@hub/shared` (`classifyTag` /
// `buildTagGroups`). This route never re-implements category rules — it only
// gathers raw test data (from the reporter sentinel block, or a legacy text
// fallback) and hands it to the shared taxonomy. That single source of truth
// is why the Hub UI is always internally consistent.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sentinel-block parsing — primary path. Reporters emit a single JSON blob
// between `__TAG_DATA_BEGIN__` / `__TAG_DATA_END__` carrying the raw per-test
// tag lists. Both the Playwright and Robot reporters use the same shape.
// ---------------------------------------------------------------------------

interface ReporterPayload {
  tool?: ToolId;
  tests?: TestSummary[];
}

function parseReporterPayload(output: string): ReporterPayload | null {
  const begin = output.indexOf('__TAG_DATA_BEGIN__');
  const end = output.indexOf('__TAG_DATA_END__');
  if (begin === -1 || end === -1 || end < begin) return null;
  const slice = output.slice(begin + '__TAG_DATA_BEGIN__'.length, end).trim();
  try {
    const parsed = JSON.parse(slice) as ReporterPayload;
    return Array.isArray(parsed.tests) ? parsed : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Legacy text fallbacks — used only when the sentinel block is absent (e.g. a
// tool failure left only the legacy text format). These yield a flat tag list
// with no per-test data, so groups fall back to alphabetical order.
// ---------------------------------------------------------------------------

function parsePlaywrightListTags(output: string): string[] {
  const tags = new Set<string>();
  for (const m of output.matchAll(/@[\w-]+/g)) {
    if (m[0]) tags.add(m[0]);
  }
  return [...tags];
}

function parseRobotTagsFromFiles(type: string, project: string): string[] {
  const specsDir = path.join(
    WORKSPACE_ROOT,
    'tools',
    'robot-framework',
    'projects',
    type,
    project,
    'automations',
    'specs',
  );
  if (!fs.existsSync(specsDir)) return [];
  const tags = new Set<string>();
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.robot')) {
        const content = fs.readFileSync(full, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('[Tags]')) continue;
          for (const t of trimmed
            .slice('[Tags]'.length)
            .trim()
            .split(/\s{2,}|\t+/)) {
            const clean = t.trim();
            if (clean && !clean.startsWith('$') && !clean.startsWith('%')) tags.add(clean);
          }
        }
      }
    }
  }
  walk(specsDir);
  return [...tags];
}

// ---------------------------------------------------------------------------
// Route helpers
// ---------------------------------------------------------------------------

async function execCapture(cmd: string): Promise<string> {
  const result = await runChild(cmd, [], {
    cwd: WORKSPACE_ROOT,
    timeoutMs: 60_000,
    shell: BASH_PATH,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  // Reporters may exit non-zero (e.g. a tool failure) while still having emitted
  // the sentinel block on stdout; on failure include stderr too so the caller
  // can fall back to the legacy text parsers.
  return result.ok ? result.stdout : result.stdout + result.stderr;
}

// ---------------------------------------------------------------------------
// Tag deduplication — merge tags that cover the EXACT same set of tests within
// the same category (true aliases, e.g. `@ta` and `@ta-main` always co-occur).
// Cross-category tags are never merged. This only collapses visual noise; it
// does not reclassify anything.
// ---------------------------------------------------------------------------

/** Canonical preference: a case-id wins, otherwise the shortest/alphabetically-first. */
function canonicalTag(tags: string[]): string {
  const caseIds = tags.filter((t) => classifyTag(t) === 'case-id');
  const pool = caseIds.length > 0 ? caseIds : tags;
  return [...pool].sort((a, b) => a.length - b.length || a.localeCompare(b))[0] ?? tags[0] ?? '';
}

function dedupeAliases(tests: TestSummary[]): TestSummary[] {
  if (tests.length === 0) return tests;

  // Signature = sorted ids of the tests a tag appears on.
  const idsByTag = new Map<string, string[]>();
  for (const t of tests) {
    const id = t.id || t.title;
    for (const tag of t.tags) {
      const list = idsByTag.get(tag);
      if (list) list.push(id);
      else idsByTag.set(tag, [id]);
    }
  }

  // Bucket tags by (kind + signature); a bucket with >1 tag = aliases.
  const buckets = new Map<string, string[]>();
  for (const [tag, ids] of idsByTag) {
    const key = `${classifyTag(tag)}\u0001${[...ids].sort().join('\u0001')}`;
    const list = buckets.get(key);
    if (list) list.push(tag);
    else buckets.set(key, [tag]);
  }

  const aliasMap = new Map<string, string>();
  for (const group of buckets.values()) {
    if (group.length <= 1) continue;
    const canonical = canonicalTag(group);
    for (const tag of group) if (tag !== canonical) aliasMap.set(tag, canonical);
  }
  if (aliasMap.size === 0) return tests;

  return tests.map((t) => ({
    ...t,
    tags: [...new Set(t.tags.map((tag) => aliasMap.get(tag) ?? tag))],
  }));
}

/** Project the per-test tag lists into a tag-first detail map (for tooltips). */
function buildDetails(tests: TestSummary[]): Record<string, TagDetail> {
  const details: Record<string, TagDetail> = {};
  for (const t of tests) {
    const child = { tag: t.id ? `@${t.id}` : '', title: t.title };
    for (const tag of t.tags) {
      const existing = details[tag];
      if (existing) {
        existing.count += 1;
        existing.tests.push(child);
      } else {
        details[tag] = { tag, count: 1, tests: [child] };
      }
    }
  }
  return details;
}

function buildResponse(
  tool: ToolId,
  type: string,
  project: string,
  payload: ReporterPayload | null,
  fallbackTags: string[],
): TagsResponse {
  // Primary path: the reporter gave us raw per-test tag lists. Dedupe aliases,
  // project to a detail map, then classify + order via the shared taxonomy.
  if (payload?.tests && payload.tests.length > 0) {
    const tests = dedupeAliases(payload.tests);
    const details = buildDetails(tests);
    const all = Object.keys(details).sort();
    const groups = buildTagGroups(all, (tag) => details[tag]?.count ?? 0);
    return { tool, type, project, groups, all, details, tests };
  }

  // Fallback path: a flat tag list only (no per-test data).
  const all = [...new Set(fallbackTags)].sort();
  return { tool, type, project, groups: buildTagGroups(all), all, details: {}, tests: [] };
}

export async function tagRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/tags?tool=playwright|robot-framework&type=web&project=example */
  app.get<{ Querystring: { tool: ToolId; type: string; project: string } }>(
    '/api/tags',
    async (req, reply) => {
      const { tool, type, project } = req.query;
      const cmd = await buildTagsCommand(tool, type, project);

      try {
        const output = await execCapture(cmd);
        let payload = parseReporterPayload(output);
        let fallbackTags: string[] = [];

        // The sentinel-block parse above is tool-agnostic and always runs. The
        // manifest's `tags.strategy` only governs the FALLBACK when the reporter
        // emitted no structured payload. Unknown / absent strategy resolves to
        // `'none'` (never throws) → empty response.
        const caps = await getToolCapabilities(tool);
        const strategy = caps?.tags.strategy ?? 'none';

        if (!payload && strategy === 'playwright-list') {
          // Playwright fallback: re-run with `--list` and scrape @tags.
          const listOutput = await execCapture(
            await buildPlaywrightListCommand(tool, type, project),
          );
          payload = parseReporterPayload(listOutput);
          if (!payload) fallbackTags = parsePlaywrightListTags(listOutput);
        } else if (!payload && strategy === 'robot-files') {
          // Robot fallback: scan .robot files for [Tags] lines.
          fallbackTags = parseRobotTagsFromFiles(type, project);
        }

        return buildResponse(tool, type, project, payload, fallbackTags);
      } catch (err) {
        reply.status(500);
        const e = err as { message?: string };
        return {
          code: 'TAG_FETCH_FAILED',
          message: `Failed to fetch tags: ${e.message ?? String(err)}`,
        };
      }
    },
  );
}

export default tagRoutes;
