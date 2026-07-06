// scripts/manifests/fs-helpers.ts
//
// Filesystem helpers shared by every manifest consumer (compose-gen,
// runner-step-render, the hub project-count guard, ...). See design §4.2.2.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToolProjectsConfig } from './types.js';

/**
 * List the non-template project folders for a tool, honouring its
 * `projects` layout config (depth 1 vs 2, fixedType slot).
 *
 * - depth === 1: projects live directly under `<root>/<fixedType?>`.
 * - depth === 2: projects live under `<root>/<type>/<project>`.
 *
 * Folders matching the `*-template-example` marker are always excluded — they
 * ship with the tool and are not user data.
 */
export function listProjectDirs(toolDir: string, cfg: ToolProjectsConfig): string[] {
  const root = path.join(toolDir, cfg.root);
  if (!fs.existsSync(root)) return [];

  if (cfg.depth === 1) {
    const targetDir = cfg.fixedType !== null ? path.join(root, cfg.fixedType) : root;
    return readDirs(targetDir).filter((n) => !isTemplate(n));
  }

  // depth === 2: iterate type folders, then projects under each.
  const projects: string[] = [];
  for (const type of readDirs(root)) {
    for (const proj of readDirs(path.join(root, type))) {
      if (!isTemplate(proj)) projects.push(proj);
    }
  }
  return projects;
}

/**
 * List immediate sub-directories of `dir`, excluding hidden folders (names
 * starting with `.`). Returns an empty list when `dir` does not exist.
 */
export function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name);
}

function readDirs(dir: string): string[] {
  return listDirs(dir);
}

/** True when a folder name is a shipped template example (`*-template-example`). */
export function isTemplate(name: string): boolean {
  return name.includes('-template-example');
}
