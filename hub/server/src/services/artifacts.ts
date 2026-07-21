import fs from 'node:fs';
import path from 'node:path';
import type { ArtifactEntry, ArtifactFolder, ArtifactType } from '@hub/shared';
import { nanoid } from 'nanoid';
import { OUTPUTS_DIR } from '../config.js';
import { isUnderOutputs } from './path-guard.js';

/** Short TTL cache for the full `outputs/` tree walk (dashboard poll hot path). */
const BROWSE_CACHE_TTL_MS = 10_000;
let browseAllCache: { value: ArtifactFolder; at: number } | null = null;
/** Per-project (tool/type/project) short-TTL cache for `browse()`. */
const browseCache = new Map<string, { value: ArtifactFolder; at: number }>();

/** Max size for an in-memory text read (readFile). Larger files must stream. */
const MAX_INLINE_READ_BYTES = 5 * 1024 * 1024; // 5 MiB

// Extension→type sets hoisted to module scope so getArtifactType doesn't rebuild
// array literals on every call (it runs once per file during a tree walk).
const SCREENSHOT_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const VIDEO_EXTS = new Set(['.mp4', '.webm']);
const LOG_EXTS = new Set(['.log', '.txt', '.md', '.csv']);

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.html': 'text/html',
  '.json': 'application/json',
  '.log': 'text/plain',
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
};

function getArtifactType(ext: string): ArtifactType {
  if (SCREENSHOT_EXTS.has(ext)) return 'screenshot';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (ext === '.zip' || ext === '.trace') return 'trace';
  if (LOG_EXTS.has(ext)) return 'log';
  if (ext === '.html') return 'html';
  if (ext === '.json' || ext === '.xml') return 'json';
  return 'other';
}

function getMimeType(ext: string): string {
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

function buildTree(dir: string, maxDepth: number, currentDepth = 0): ArtifactFolder {
  const name = path.basename(dir);
  const folder: ArtifactFolder = {
    name,
    path: dir,
    children: [],
    totalSize: 0,
    fileCount: 0,
  };

  if (!fs.existsSync(dir) || currentDepth > maxDepth) return folder;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (['node_modules', '.git', '__pycache__'].includes(entry.name)) continue;
      const child = buildTree(fullPath, maxDepth, currentDepth + 1);
      folder.children.push(child);
      folder.totalSize += child.totalSize;
      folder.fileCount += child.fileCount;
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      const stat = fs.statSync(fullPath);
      const artifact: ArtifactEntry = {
        id: nanoid(8),
        name: entry.name,
        type: getArtifactType(ext),
        path: fullPath,
        size: stat.size,
        mimeType: getMimeType(ext),
        createdAt: stat.mtime.toISOString(),
      };
      folder.children.push(artifact);
      folder.totalSize += stat.size;
      folder.fileCount++;
    }
  }

  return folder;
}

function collectArtifacts(dir: string, out: ArtifactEntry[], maxDepth: number, depth = 0): void {
  if (depth > maxDepth || !fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!['node_modules', '.git'].includes(entry.name)) {
        collectArtifacts(fullPath, out, maxDepth, depth + 1);
      }
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      const type = getArtifactType(ext);
      if (type !== 'other' && type !== 'html') {
        const stat = fs.statSync(fullPath);
        out.push({
          id: nanoid(8),
          name: entry.name,
          type,
          path: fullPath,
          size: stat.size,
          mimeType: getMimeType(ext),
          createdAt: stat.mtime.toISOString(),
        });
      }
    }
  }
}

class ArtifactService {
  browse(tool: string, type: string, project: string): ArtifactFolder {
    const key = `${tool}/${type}/${project}`;
    const now = Date.now();
    const cached = browseCache.get(key);
    // Same rationale as browseAll: the depth-6 walk is synchronous and hit on
    // every artifacts-page poll. Cache per project for a short window; dropped
    // on artifact deletion via invalidateBrowseAll for immediate consistency.
    if (cached && now - cached.at < BROWSE_CACHE_TTL_MS) return cached.value;
    const projectDir = path.join(OUTPUTS_DIR, tool, type, project);
    if (!fs.existsSync(projectDir)) {
      return { name: project, path: projectDir, children: [], totalSize: 0, fileCount: 0 };
    }
    const value = buildTree(projectDir, 6);
    browseCache.set(key, { value, at: now });
    return value;
  }

  browseAll(): ArtifactFolder {
    if (!fs.existsSync(OUTPUTS_DIR)) {
      return { name: 'outputs', path: OUTPUTS_DIR, children: [], totalSize: 0, fileCount: 0 };
    }
    // Recursively walking `outputs/` is the slow part of every dashboard poll
    // (synchronous fs walk blocks the event loop). Cache the tree for a short
    // window; `invalidateBrowseAll()` drops it on artifact deletion for
    // immediate consistency. Fresh run output appears within the TTL.
    // ponytail: the walk is still synchronous on a cache miss — staleness ceiling
    // is BROWSE_CACHE_TTL_MS. Upgrade path if misses ever stall the loop: move
    // `buildTree` to `fs.promises` (async) and lower the depth-14 default.
    const now = Date.now();
    if (!browseAllCache || now - browseAllCache.at >= BROWSE_CACHE_TTL_MS) {
      browseAllCache = { value: buildTree(OUTPUTS_DIR, 14), at: now };
    }
    return browseAllCache.value;
  }

  /** Drop the cached `browseAll` + per-project `browse` trees so the next call
   *  re-walks `outputs/`. */
  invalidateBrowseAll(): void {
    browseAllCache = null;
    browseCache.clear();
  }

  getForReport(reportPath: string): ArtifactEntry[] {
    const dir = path.dirname(reportPath);
    if (!fs.existsSync(dir)) return [];

    const artifacts: ArtifactEntry[] = [];
    collectArtifacts(dir, artifacts, 2);
    return artifacts;
  }

  readFile(filePath: string): { content: string; mimeType: string } | null {
    const resolved = path.resolve(filePath);
    // isUnderOutputs resolves `..` and appends a separator, closing the
    // prefix-escape a bare startsWith allows (e.g. a sibling `outputs-evil/`).
    if (!isUnderOutputs(resolved)) return null;
    if (!fs.existsSync(resolved)) return null;

    const ext = path.extname(resolved).toLowerCase();
    const mimeType = getMimeType(ext);

    if (
      !mimeType.startsWith('text/') &&
      mimeType !== 'application/json' &&
      mimeType !== 'application/xml'
    ) {
      return null;
    }

    // Cap in-memory text reads so a runaway log can't block the event loop or
    // OOM the server. Larger files should be streamed via serveInfo instead.
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size > MAX_INLINE_READ_BYTES) return null;

    const content = fs.readFileSync(resolved, 'utf8');
    return { content, mimeType };
  }

  getFileInfo(filePath: string): ArtifactEntry | null {
    const resolved = path.resolve(filePath);
    if (!isUnderOutputs(resolved)) return null;
    if (!fs.existsSync(resolved)) return null;

    const stat = fs.statSync(resolved);
    const ext = path.extname(resolved).toLowerCase();

    return {
      id: nanoid(8),
      name: path.basename(resolved),
      type: getArtifactType(ext),
      path: resolved,
      size: stat.size,
      mimeType: getMimeType(ext),
      createdAt: stat.mtime.toISOString(),
    };
  }

  /**
   * Validate + stat a file for **streamed** serving (images / video / trace zip).
   * Returns metadata only — the route streams via `fs.createReadStream` so the
   * file is never buffered whole into memory. Uses `isUnderOutputs` (resolves
   * `..` and appends a separator) instead of a bare `startsWith`, which closes a
   * prefix-escape (e.g. a sibling `outputs-evil/`).
   */
  serveInfo(filePath: string): { path: string; size: number; mimeType: string } | null {
    const resolved = path.resolve(filePath);
    if (!isUnderOutputs(resolved)) return null;
    if (!fs.existsSync(resolved)) return null;
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return null;
    return {
      path: resolved,
      size: stat.size,
      mimeType: getMimeType(path.extname(resolved).toLowerCase()),
    };
  }
}

export const artifactService = new ArtifactService();
