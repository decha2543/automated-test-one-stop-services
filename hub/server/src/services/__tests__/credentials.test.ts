import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// SCRIPTS_DIR is read lazily by the service, so a getter-backed mock lets each
// test point it at a fresh temp workspace.
const hoisted = vi.hoisted(() => ({ scriptsDir: '' }));

vi.mock('../../config.js', () => ({
  get SCRIPTS_DIR() {
    return hoisted.scriptsDir;
  },
}));

import { listCredentialStatus, saveCredentials } from '../credentials.js';

describe('credentials service', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'creds-'));
    hoisted.scriptsDir = tmp;
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function mkTool(
    name: string,
    opts: { withCredentialsDir?: boolean; withJson?: boolean } = {},
  ): void {
    const toolDir = path.join(tmp, 'third-party', name);
    fs.mkdirSync(toolDir, { recursive: true });
    if (opts.withCredentialsDir) {
      const credDir = path.join(toolDir, 'credentials');
      fs.mkdirSync(credDir, { recursive: true });
      if (opts.withJson) fs.writeFileSync(path.join(credDir, 'credentials.json'), '{"a":1}');
    }
  }

  describe('listCredentialStatus()', () => {
    it('returns empty when third-party dir is absent', () => {
      expect(listCredentialStatus()).toEqual([]);
    });

    it('omits tools without a credentials/ folder', () => {
      mkTool('plain');
      mkTool('google', { withCredentialsDir: true });
      expect(listCredentialStatus().map((s) => s.tool)).toEqual(['google']);
    });

    it('reports hasCredentials based on credentials.json presence, sorted by tool', () => {
      mkTool('google', { withCredentialsDir: true, withJson: true });
      mkTool('aws', { withCredentialsDir: true });
      expect(listCredentialStatus()).toEqual([
        { tool: 'aws', hasCredentials: false },
        { tool: 'google', hasCredentials: true },
      ]);
    });

    it('ignores dotfiles', () => {
      fs.mkdirSync(path.join(tmp, 'third-party'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'third-party', '.gitkeep'), '');
      expect(listCredentialStatus()).toEqual([]);
    });
  });

  describe('saveCredentials()', () => {
    it('rejects unsafe tool names (path traversal)', () => {
      const r = saveCredentials('../evil', '{}');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('INVALID_TOOL_NAME');
    });

    it('rejects when the tool has no credentials/ folder', () => {
      mkTool('plain');
      const r = saveCredentials('plain', '{}');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('NO_CREDENTIALS_DIR');
    });

    it('rejects invalid JSON', () => {
      mkTool('google', { withCredentialsDir: true });
      const r = saveCredentials('google', 'not json');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('INVALID_JSON');
    });

    it('writes credentials.json on success and reports a scripts-relative path', () => {
      mkTool('google', { withCredentialsDir: true });
      const r = saveCredentials('google', '{"client_id":"x"}');
      expect(r.ok).toBe(true);
      const written = fs.readFileSync(
        path.join(tmp, 'third-party', 'google', 'credentials', 'credentials.json'),
        'utf8',
      );
      expect(written).toContain('client_id');
      if (r.ok) {
        expect(r.path.replace(/\\/g, '/')).toBe('third-party/google/credentials/credentials.json');
      }
    });
  });
});
