import fs from 'node:fs';
import path from 'node:path';
import type { EnvEntry, EnvFile, ToolId } from '@hub/shared';
import { SCRIPTS_DIR, TOOLS_DIR } from '../config.js';
import { parseEnv } from './env-parser.js';

function resolveProjectEnvDir(tool: ToolId, type: string, project: string): string {
  return path.join(TOOLS_DIR, tool, 'projects', type, project);
}

function readEnvFile(envPath: string, tplPath: string): EnvFile {
  const exists = fs.existsSync(envPath);
  const hasTemplate = fs.existsSync(tplPath);

  const entries = exists ? parseEnv(fs.readFileSync(envPath, 'utf8')) : [];

  const missingKeys: string[] = [];
  if (hasTemplate) {
    const tplEntries = parseEnv(fs.readFileSync(tplPath, 'utf8'));
    const envKeys = new Set(entries.map((e) => e.key));
    for (const te of tplEntries) {
      if (!envKeys.has(te.key)) {
        missingKeys.push(te.key);
        entries.push({ ...te, fromTemplate: true });
      }
    }
  }

  const relPath = path.relative(path.join(TOOLS_DIR, '..'), envPath).replace(/\\/g, '/');
  return { path: relPath, exists, hasTemplate, entries, missingKeys };
}

export function getProjectEnv(tool: ToolId, type: string, project: string): EnvFile {
  const dir = resolveProjectEnvDir(tool, type, project);
  return readEnvFile(path.join(dir, '.env'), path.join(dir, '.env.template'));
}

export function getScriptsEnv(): EnvFile {
  const file = readEnvFile(path.join(SCRIPTS_DIR, '.env'), path.join(SCRIPTS_DIR, '.env.template'));
  return { ...file, path: 'scripts/.env' };
}

export function getTemplateEntries(tool: ToolId, type: string, project: string): EnvEntry[] | null {
  const dir = resolveProjectEnvDir(tool, type, project);
  const tplPath = path.join(dir, '.env.template');
  if (!fs.existsSync(tplPath)) return null;
  return parseEnv(fs.readFileSync(tplPath, 'utf8'));
}

export function saveEnvFile(
  tool: ToolId | 'scripts',
  type: string,
  project: string,
  entries: EnvEntry[],
): void {
  const envPath =
    tool === 'scripts'
      ? path.join(SCRIPTS_DIR, '.env')
      : path.join(resolveProjectEnvDir(tool, type, project), '.env');

  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.comment) lines.push(`# ${entry.comment}`);
    lines.push(`${entry.key}=${entry.value}`);
  }
  fs.writeFileSync(envPath, `${lines.join('\n')}\n`, 'utf8');
}
