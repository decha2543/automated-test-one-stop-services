// scripts/manifests/__tests__/capabilities.spec.ts
//
// Unit tests for the optional manifest capability blocks (`run` / `reports` /
// `tags`) and their default-resolution helper `resolveCapabilities()`
// (design §7.1, §7.3; requirements 9.1, 9.2, 9.3, 10.4).
//
// Three guarantees are covered:
//   (a) a manifest WITH all three blocks parses and the values round-trip;
//   (b) a manifest WITHOUT the blocks parses and resolves to the safe defaults
//       (no extra vars, `**/*.html` glob, `tags.strategy: 'none'`);
//   (c) an UNKNOWN `tags.strategy` resolves to `'none'` rather than throwing.
//
// Validates: Requirements 9.1, 9.2, 9.3, 10.4
import { describe, expect, it } from 'vitest';
import type { ToolManifest } from '../types.js';
import { DEFAULT_REPORT_GLOB, resolveCapabilities, validateManifest } from '../validate.js';
import { baseManifest } from './_helpers.js';

/** Parse a manifest JSON object and fail loudly if it does not validate. */
function parseOrThrow(json: Record<string, unknown>): ToolManifest {
  const res = validateManifest(json);
  if (!res.ok) {
    throw new Error(`expected valid manifest but got: ${JSON.stringify(res.errors)}`);
  }
  return res.manifest;
}

describe('capability blocks — parse + round-trip (req 9.1)', () => {
  it('accepts a manifest carrying all three capability blocks and keeps schemaVersion "1"', () => {
    const m = baseManifest();
    m.run = {
      vars: [
        { name: 'SECTION', when: 'sectionAxis' },
        { name: 'PERFORMANCE_TYPE', when: 'always' },
      ],
      headlessVar: 'HEADLESS:{value}',
    };
    m.reports = { resultGlob: '**/summary.html', kind: 'html' };
    m.tags = { strategy: 'playwright-list' };

    const manifest = parseOrThrow(m);

    expect(manifest.schemaVersion).toBe('1');
    expect(manifest.run).toEqual({
      vars: [
        { name: 'SECTION', when: 'sectionAxis' },
        { name: 'PERFORMANCE_TYPE', when: 'always' },
      ],
      headlessVar: 'HEADLESS:{value}',
    });
    expect(manifest.reports).toEqual({ resultGlob: '**/summary.html', kind: 'html' });
    expect(manifest.tags).toEqual({ strategy: 'playwright-list' });
  });

  it('resolves a fully-populated manifest to its declared capability values', () => {
    const m = baseManifest();
    m.run = { vars: [{ name: 'SECTION', when: 'sectionAxis' }], headlessVar: 'HEADLESS:{value}' };
    m.reports = { resultGlob: '**/report.html', kind: 'html' };
    m.tags = { strategy: 'robot-files' };

    const resolved = resolveCapabilities(parseOrThrow(m));

    expect(resolved.run.vars).toEqual([{ name: 'SECTION', when: 'sectionAxis' }]);
    expect(resolved.run.headlessVar).toBe('HEADLESS:{value}');
    expect(resolved.reports.resultGlob).toBe('**/report.html');
    expect(resolved.reports.kind).toBe('html');
    expect(resolved.tags.strategy).toBe('robot-files');
  });

  it('rejects an unknown run.vars[].when value (enum is closed)', () => {
    const m = baseManifest();
    m.run = { vars: [{ name: 'SECTION', when: 'whenever' }] };
    const res = validateManifest(m);
    expect(res.ok).toBe(false);
  });
});

describe('capability blocks — absent ⇒ safe defaults (req 10.4, design §7.3)', () => {
  it('parses a manifest with no capability blocks', () => {
    const m = baseManifest();
    expect(m.run).toBeUndefined();
    expect(m.reports).toBeUndefined();
    expect(m.tags).toBeUndefined();
    const manifest = parseOrThrow(m);
    expect(manifest.run).toBeUndefined();
    expect(manifest.reports).toBeUndefined();
    expect(manifest.tags).toBeUndefined();
  });

  it('resolves absent blocks to: no run vars, generic **/*.html glob, tags:none', () => {
    const resolved = resolveCapabilities(parseOrThrow(baseManifest()));

    expect(resolved.run.vars).toEqual([]);
    expect(resolved.run.headlessVar).toBeNull();
    expect(resolved.reports.resultGlob).toBe('**/*.html');
    expect(resolved.reports.resultGlob).toBe(DEFAULT_REPORT_GLOB);
    expect(resolved.reports.kind).toBeNull();
    expect(resolved.tags.strategy).toBe('none');
  });

  it('fills only the missing fields of a partially-specified block', () => {
    const m = baseManifest();
    m.reports = { resultGlob: '**/index.html' }; // kind omitted
    m.run = { vars: [{ name: 'PERFORMANCE_TYPE', when: 'always' }] }; // headlessVar omitted

    const resolved = resolveCapabilities(parseOrThrow(m));

    expect(resolved.reports.resultGlob).toBe('**/index.html');
    expect(resolved.reports.kind).toBeNull();
    expect(resolved.run.vars).toEqual([{ name: 'PERFORMANCE_TYPE', when: 'always' }]);
    expect(resolved.run.headlessVar).toBeNull();
  });
});

describe('capability blocks — unknown tags.strategy degrades to none (req 9.2, design §7.3)', () => {
  it('resolves an unknown strategy string to "none" without throwing', () => {
    const m = baseManifest();
    m.tags = { strategy: 'cypress-grep' }; // not a known strategy

    const manifest = parseOrThrow(m); // open string ⇒ still parses
    expect(manifest.tags).toEqual({ strategy: 'cypress-grep' });

    const resolved = resolveCapabilities(manifest);
    expect(resolved.tags.strategy).toBe('none');
  });

  it('preserves each known strategy verbatim', () => {
    for (const strategy of ['playwright-list', 'robot-files', 'none'] as const) {
      const m = baseManifest();
      m.tags = { strategy };
      const resolved = resolveCapabilities(parseOrThrow(m));
      expect(resolved.tags.strategy).toBe(strategy);
    }
  });

  it('resolves an empty tags block (strategy omitted) to "none"', () => {
    const m = baseManifest();
    m.tags = {};
    const resolved = resolveCapabilities(parseOrThrow(m));
    expect(resolved.tags.strategy).toBe('none');
  });
});
