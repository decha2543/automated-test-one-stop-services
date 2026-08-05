import fs from 'node:fs';
import path from 'node:path';
import type { HubUser, HubUserSaveResult } from '@hub/shared';
import { nanoid } from 'nanoid';
import { TOOLS_DIR } from '../config.js';
import { loadJson, saveJson } from './persistence.js';
import { editedPathFor, listTestCaseDocs, renameEditedBy } from './testcases.js';

/** Local_DB dataset holding the Hub's single user identity. */
const STORE = 'hub-user.json';
const MAX_NAME_LENGTH = 60;

/**
 * The Hub runs as one person's local tool, so there is exactly one identity: the
 * name that auto-fills "Edited By" on test-case rows. It is stored server-side
 * (not in the browser) because the server is what stamps the column and what has
 * to rewrite past stamps on a rename.
 *
 * Returns null until the user has set a name — the client uses that to require
 * one on first visit.
 */
export function getHubUser(): HubUser | null {
  const stored = loadJson<HubUser | null>(STORE, null);
  if (!stored?.id || !stored.name) return null;
  return stored;
}

/** Trim + cap a submitted display name. Empty after trimming means invalid. */
export function normalizeUserName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH);
  return name === '' ? null : name;
}

/**
 * Create or rename the Hub user.
 *
 * The id is minted once and never changes, so a rename can find every row this
 * user stamped and rewrite "Edited By" to the new name — matching on the old
 * name would be ambiguous and would also miss rows whose name was edited by
 * hand. Only `.edited.json` overlays are rewritten; source docs stay untouched.
 */
export function saveHubUser(name: string): HubUserSaveResult {
  const now = new Date().toISOString();
  const existing = getHubUser();
  const user: HubUser = existing
    ? { ...existing, name, updatedAt: now }
    : { id: nanoid(10), name, createdAt: now, updatedAt: now };
  saveJson(STORE, user);
  if (!existing || existing.name === name) {
    return { user, rowsRenamed: 0, docsTouched: 0 };
  }
  const { rowsRenamed, docsTouched } = renameEditedBy(overlayBackedDocs(), user.id, name);
  return { user, rowsRenamed, docsTouched };
}

/**
 * Every test-case doc under `tools/` that already has an overlay. Docs without
 * one hold no Hub-stamped "Edited By", so a rename can skip them entirely.
 */
function overlayBackedDocs(): string[] {
  const docs: string[] = [];
  for (const projectDir of projectDirs()) {
    for (const doc of listTestCaseDocs(projectDir)) {
      if (fs.existsSync(editedPathFor(doc.path))) docs.push(doc.path);
    }
  }
  return docs;
}

/** Every `tools/<tool>/projects/<type>/<project>` directory present on disk. */
function projectDirs(): string[] {
  const dirs: string[] = [];
  for (const tool of subDirs(TOOLS_DIR)) {
    const projectsDir = path.join(TOOLS_DIR, tool, 'projects');
    for (const type of subDirs(projectsDir)) {
      const typeDir = path.join(projectsDir, type);
      for (const project of subDirs(typeDir)) dirs.push(path.join(typeDir, project));
    }
  }
  return dirs;
}

/** Immediate subdirectory names of `dir`, hidden ones excluded. Never throws. */
function subDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}
