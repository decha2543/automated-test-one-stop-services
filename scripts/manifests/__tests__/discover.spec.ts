// scripts/manifests/__tests__/discover.spec.ts
//
// Unit tests for `scripts/manifests/discover.ts` (design §8.1, §4.1.2).
// Covers empty `tools/`, hidden-folder exclusion, manifest-presence filtering,
// sort stability, and idempotence.
//
// Validates: Requirements 2.1, 2.2
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverManifestPaths, MANIFEST_FILENAME } from '../discover.js';
import { makeTmpDir, mkDir, rmTmpDir, writeToolManifest } from './_helpers.js';

describe('discoverManifestPaths', () => {
  let ws: string;

  beforeEach(() => {
    ws = makeTmpDir('discover-');
  });

  afterEach(() => {
    rmTmpDir(ws);
  });

  it('returns an empty list when tools/ does not exist', () => {
    expect(discoverManifestPaths(ws)).toEqual([]);
  });

  it('returns an empty list when tools/ exists but holds no manifests', () => {
    mkDir(ws, 'tools', 'empty-tool'); // folder with no manifest
    expect(discoverManifestPaths(ws)).toEqual([]);
  });

  it('discovers one manifest per tool folder that contains the manifest file', () => {
    writeToolManifest(ws, 'playwright');
    writeToolManifest(ws, 'k6');
    const paths = discoverManifestPaths(ws);
    expect(paths).toHaveLength(2);
    for (const p of paths) {
      expect(path.basename(p)).toBe(MANIFEST_FILENAME);
      expect(fs.existsSync(p)).toBe(true);
    }
  });

  it('excludes folders whose name starts with "." (req 2.1)', () => {
    writeToolManifest(ws, 'playwright');
    // A hidden folder that nonetheless contains a manifest must be skipped.
    const hiddenDir = mkDir(ws, 'tools', '.hidden-tool');
    fs.writeFileSync(path.join(hiddenDir, MANIFEST_FILENAME), '{}');
    const paths = discoverManifestPaths(ws);
    expect(paths.some((p) => p.includes('.hidden-tool'))).toBe(false);
    expect(paths).toHaveLength(1);
  });

  it('excludes tool folders that lack a manifest file', () => {
    writeToolManifest(ws, 'playwright');
    mkDir(ws, 'tools', 'no-manifest-here');
    const paths = discoverManifestPaths(ws);
    expect(paths.some((p) => p.includes('no-manifest-here'))).toBe(false);
    expect(paths).toHaveLength(1);
  });

  it('excludes "*-template-example" tool folders even when they hold a manifest', () => {
    writeToolManifest(ws, 'playwright');
    // A shared scaffold dir carrying a valid manifest must NOT be discovered.
    const templateDir = mkDir(ws, 'tools', 'tool-template-example');
    fs.writeFileSync(path.join(templateDir, MANIFEST_FILENAME), '{}');
    const paths = discoverManifestPaths(ws);
    expect(paths.some((p) => p.includes('tool-template-example'))).toBe(false);
    expect(paths).toHaveLength(1);
  });

  it('returns a stably sorted list regardless of creation order (req 2.2)', () => {
    // Create in deliberately non-alphabetical order.
    for (const id of ['zulu', 'alpha', 'mike', 'bravo']) {
      writeToolManifest(ws, id);
    }
    const paths = discoverManifestPaths(ws);
    const sorted = [...paths].sort();
    expect(paths).toEqual(sorted);
  });

  it('is idempotent — repeated scans return identical lists (Property 3)', () => {
    for (const id of ['robot-framework', 'k6', 'playwright']) {
      writeToolManifest(ws, id);
    }
    const first = discoverManifestPaths(ws);
    const second = discoverManifestPaths(ws);
    expect(first).toEqual(second);
  });
});
