// scripts/manifests/__tests__/versions-source.spec.ts
//
// Example test for the single tool-version source of truth (design D6-A).
// Asserts scripts/setup/versions.env is the only place the Node/Python version
// literals live: both platform installers reference versions.env and neither
// re-declares a NODE_VERSION/PYTHON_VERSION literal. Also guards drift against
// the Volta pin in package.json (the Node runtime authority).
//
// Validates: Requirements 5.4
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const SETUP_DIR = path.join(REPO_ROOT, 'scripts', 'setup');
const VERSIONS_ENV = path.join(SETUP_DIR, 'versions.env');
const WIN_SCRIPT = path.join(SETUP_DIR, 'setup-windows.bat');
const NIX_SCRIPT = path.join(SETUP_DIR, 'setup-linux.sh');

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

/** Pull a KEY=value entry out of versions.env (ignores #-comment lines). */
function readVersion(env: string, key: string): string | undefined {
  return new RegExp(`^${key}=(.+)$`, 'm').exec(env)?.[1]?.trim();
}

describe('single tool-version source of truth (versions.env)', () => {
  const env = read(VERSIONS_ENV);
  const nodeVersion = readVersion(env, 'NODE_VERSION') ?? '';
  const pythonVersion = readVersion(env, 'PYTHON_VERSION') ?? '';

  it('versions.env declares NODE_VERSION and PYTHON_VERSION values', () => {
    expect(nodeVersion).toMatch(/^\d+\.\d+/);
    expect(pythonVersion).toMatch(/^\d+\.\d+/);
  });

  it('NODE_VERSION stays in sync with the Volta pin in package.json', () => {
    const pkg = JSON.parse(read(path.join(REPO_ROOT, 'package.json'))) as {
      volta?: { node?: string };
    };
    expect(pkg.volta?.node).toBe(nodeVersion);
  });

  for (const [label, file] of [
    ['setup-windows.bat', WIN_SCRIPT],
    ['setup-linux.sh', NIX_SCRIPT],
  ] as const) {
    describe(label, () => {
      const body = read(file);

      it('references versions.env', () => {
        expect(body).toContain('versions.env');
      });

      it('does not duplicate the NODE_VERSION / PYTHON_VERSION literals', () => {
        // The literal version numbers must live only in versions.env.
        expect(body).not.toContain(nodeVersion);
        expect(body).not.toContain(pythonVersion);
        // And no inline `NODE_VERSION=<number>` / `PYTHON_VERSION=<number>` assignment.
        expect(body).not.toMatch(/NODE_VERSION\s*=\s*"?\d/);
        expect(body).not.toMatch(/PYTHON_VERSION\s*=\s*"?\d/);
      });
    });
  }
});
