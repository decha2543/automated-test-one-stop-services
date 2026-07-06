// scripts/manifests/tsconfig-gen.ts
//
// Manifest-driven generator for a tool's `tsconfig.json` path aliases. Replaces
// the hardcoded Playwright-only `generateTsConfig()` in `scripts/sync-projects.ts`.
// Driven by `manifest.tsconfigGen` (null for tools that ship no generated
// tsconfig, e.g. Robot Framework / k6). See design §3.1.1 (ToolTsconfigGenConfig)
// and §4.2.1 (caller only invokes this when `tsconfigGen !== null`).
//
// Behaviour:
//   - Reads the JSONC template named by `manifest.tsconfigGen.template`.
//   - Adds one `<aliasPrefix><project>/*` -> [<aliasTarget>] entry per project,
//     substituting {type} and {project} into `aliasTarget`.
//   - Writes the resolved JSON to `manifest.tsconfigGen.output`.
//   - When the template is absent it logs a warning and returns WITHOUT throwing
//     so a single broken tool never aborts the whole sync (Requirement 4.6).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { listDirs } from './fs-helpers.js';
import type { ToolManifest, ToolProjectsConfig } from './types.js';

/** Minimal structural view of the parts of a tsconfig we mutate. */
interface TsConfigJson {
  compilerOptions?: {
    paths?: Record<string, string[]>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** A discovered `<type>/<project>` pair used to build a single path alias. */
interface ProjectEntry {
  readonly type: string;
  readonly project: string;
}

/**
 * Walk a tool's project tree into `<type, project>` pairs, honouring the
 * `projects` layout config (depth 1 with a fixedType slot vs depth 2 type/project).
 * Mirrors the directory-iteration order of the legacy generator so the emitted
 * alias order is preserved.
 */
function listProjectEntries(toolDir: string, cfg: ToolProjectsConfig): ProjectEntry[] {
  const root = path.join(toolDir, cfg.root);
  if (!fs.existsSync(root)) return [];

  if (cfg.depth === 1) {
    const type = cfg.fixedType ?? '';
    const targetDir = cfg.fixedType !== null ? path.join(root, cfg.fixedType) : root;
    return listDirs(targetDir).map((project) => ({ type, project }));
  }

  // depth === 2: iterate type folders, then projects under each.
  const entries: ProjectEntry[] = [];
  for (const type of listDirs(root)) {
    for (const project of listDirs(path.join(root, type))) {
      entries.push({ type, project });
    }
  }
  return entries;
}

/**
 * Parse a JSONC tsconfig template (strip `//` line comments + trailing commas
 * before `JSON.parse`). Mirrors the legacy stripping so the parsed object — and
 * therefore the serialised output — is byte-for-byte identical.
 */
function parseJsonc(content: string): TsConfigJson {
  const stripped = content.replace(/\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(stripped) as TsConfigJson;
}

/**
 * Generate `tools/<id>/<tsconfigGen.output>` for a single tool. No-op when the
 * tool declares no generated tsconfig (`tsconfigGen === null`). IO-only; never
 * throws on a missing or unparseable template (logs and returns instead).
 */
export function generateTsConfig(workspaceRoot: string, tool: ToolManifest): void {
  const cfg = tool.tsconfigGen;
  if (cfg === null) return;

  const toolDir = path.join(workspaceRoot, 'tools', tool.id);
  const templatePath = path.join(toolDir, cfg.template);
  if (!fs.existsSync(templatePath)) {
    console.error(`⚠ Tsconfig template missing for ${tool.id}: ${templatePath}`);
    return;
  }

  const content = fs.readFileSync(templatePath, 'utf8');
  let tsConfig: TsConfigJson;
  try {
    tsConfig = parseJsonc(content);
  } catch (_err) {
    console.error(`⚠ Tsconfig template unparseable for ${tool.id}: ${templatePath}`);
    return;
  }

  const compilerOptions = tsConfig.compilerOptions ?? {};
  const paths = compilerOptions.paths ?? {};

  for (const { type, project } of listProjectEntries(toolDir, tool.projects)) {
    const key = `${cfg.aliasPrefix}${project}/*`;
    const target = cfg.aliasTarget.replace(/\{type\}/g, type).replace(/\{project\}/g, project);
    paths[key] = [target];
  }

  compilerOptions.paths = paths;
  tsConfig.compilerOptions = compilerOptions;

  const targetPath = path.join(toolDir, cfg.output);
  fs.writeFileSync(targetPath, JSON.stringify(tsConfig, null, 2), 'utf8');
  console.log(`✅ ${tool.id} → ${cfg.output} (path aliases)`);
}
