// scripts/manifests/__tests__/fs-helpers.spec.ts
//
// Unit tests for `scripts/manifests/fs-helpers.ts` (design §8.1, §4.2.2).
// Covers depth=1 (with + without fixedType), depth=2, template-example
// exclusion, hidden-folder exclusion, and missing-directory handling.
//
// Validates: Requirements 2.1, 2.2 (project enumeration determinism + exclusion)
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isTemplate, listDirs, listProjectDirs } from '../fs-helpers.js';
import type { ToolProjectsConfig } from '../types.js';
import { makeTmpDir, mkDir, rmTmpDir } from './_helpers.js';

function projectsConfig(overrides: Partial<ToolProjectsConfig>): ToolProjectsConfig {
  return {
    root: 'projects',
    depth: 2,
    typeAxis: true,
    fixedType: null,
    templates: {},
    specsSubdir: 'automations/specs',
    sectionAxis: false,
    ...overrides,
  };
}

describe('isTemplate', () => {
  it('returns true for *-template-example folders', () => {
    expect(isTemplate('playwright-web-template-example')).toBe(true);
    expect(isTemplate('k6-performance-template-example')).toBe(true);
  });

  it('returns false for real project folders', () => {
    expect(isTemplate('ecom')).toBe(false);
    expect(isTemplate('checkout-web')).toBe(false);
    expect(isTemplate('template')).toBe(false); // partial word, not the marker
  });
});

describe('listDirs', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir('listdirs-');
  });

  afterEach(() => {
    rmTmpDir(dir);
  });

  it('returns an empty list for a non-existent directory', () => {
    expect(listDirs(path.join(dir, 'does-not-exist'))).toEqual([]);
  });

  it('lists immediate sub-directories, excluding hidden ones and files', () => {
    mkDir(dir, 'web');
    mkDir(dir, 'api');
    mkDir(dir, '.hidden');
    // a file should not be listed
    fs.writeFileSync(path.join(dir, 'readme.md'), 'x');
    const dirs = listDirs(dir).sort();
    expect(dirs).toEqual(['api', 'web']);
  });
});

describe('listProjectDirs — depth=2 (typeAxis)', () => {
  let tool: string;

  beforeEach(() => {
    tool = makeTmpDir('depth2-');
  });

  afterEach(() => {
    rmTmpDir(tool);
  });

  it('collects projects under <root>/<type>/<project>, excluding template examples', () => {
    mkDir(tool, 'projects', 'web', 'ecom');
    mkDir(tool, 'projects', 'web', 'playwright-web-template-example');
    mkDir(tool, 'projects', 'api', 'payments');
    mkDir(tool, 'projects', 'api', 'playwright-api-template-example');

    const projects = listProjectDirs(tool, projectsConfig({ depth: 2 })).sort();
    expect(projects).toEqual(['ecom', 'payments']);
  });

  it('returns an empty list when the projects root is absent', () => {
    expect(listProjectDirs(tool, projectsConfig({ depth: 2 }))).toEqual([]);
  });
});

describe('listProjectDirs — depth=1 with fixedType', () => {
  let tool: string;

  beforeEach(() => {
    tool = makeTmpDir('depth1fixed-');
  });

  afterEach(() => {
    rmTmpDir(tool);
  });

  it('collects projects under <root>/<fixedType>/<project>, excluding templates', () => {
    mkDir(tool, 'projects', 'performance', 'checkout-load');
    mkDir(tool, 'projects', 'performance', 'k6-performance-template-example');

    const projects = listProjectDirs(
      tool,
      projectsConfig({ depth: 1, typeAxis: false, fixedType: 'performance', sectionAxis: true }),
    );
    expect(projects).toEqual(['checkout-load']);
  });
});

describe('listProjectDirs — depth=1 without fixedType', () => {
  let tool: string;

  beforeEach(() => {
    tool = makeTmpDir('depth1flat-');
  });

  afterEach(() => {
    rmTmpDir(tool);
  });

  it('collects projects directly under <root>, excluding templates', () => {
    mkDir(tool, 'projects', 'service-a');
    mkDir(tool, 'projects', 'service-b');
    mkDir(tool, 'projects', 'generic-template-example');

    const projects = listProjectDirs(
      tool,
      projectsConfig({ depth: 1, typeAxis: false, fixedType: null }),
    ).sort();
    expect(projects).toEqual(['service-a', 'service-b']);
  });
});
