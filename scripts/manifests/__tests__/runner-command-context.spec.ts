// scripts/manifests/__tests__/runner-command-context.spec.ts
//
// Unit tests for the capability-driven execution-context builders added in
// task 17 (design §7.1, §7.2): `RunnerContext`, `buildRunVarTokens`, and
// `buildHeadlessToken`. These extend the runner command-builder so the CLI
// runner and the Hub (task 18) construct tool-specific run vars + the headless
// token from `manifest.run` alone — no tool literals.
//
// Fixtures are constructed INLINE (not read from `tools/*/tool.manifest.json`)
// so this suite is independent of the parallel built-in backfill (task 16):
//   - k6:        run.vars = [SECTION@sectionAxis, PERFORMANCE_TYPE@always]
//   - robot:     run.headlessVar = '--variable HEADLESS:{value}'
//   - playwright: no run block (capabilities resolve to safe defaults)
//
// The assembled-command tests show how task 18 slots the capability tokens into
// the exact legacy built-in command tails (local + docker + headless).
//
// Validates: Requirements 9.1
import { describe, expect, it } from 'vitest';
import { buildHeadlessToken, buildRunVarTokens, type RunnerContext } from '../runner-command.js';
import type { ToolManifest } from '../types.js';
import { validateManifest } from '../validate.js';
import { baseManifest } from './_helpers.js';

/** Parse a manifest JSON object and fail loudly if it does not validate. */
function parseOrThrow(json: Record<string, unknown>): ToolManifest {
  const res = validateManifest(json);
  if (!res.ok) {
    throw new Error(`expected valid manifest but got: ${JSON.stringify(res.errors)}`);
  }
  return res.manifest;
}

/** k6-shaped fixture: section axis on, two run vars (sectionAxis + always). */
function k6Fixture(): ToolManifest {
  const m = baseManifest();
  m.id = 'k6';
  m.alias = 'k6';
  (m.projects as Record<string, unknown>).typeAxis = false;
  (m.projects as Record<string, unknown>).fixedType = 'performance';
  (m.projects as Record<string, unknown>).sectionAxis = true;
  (m.projects as Record<string, unknown>).depth = 1;
  m.run = {
    vars: [
      { name: 'SECTION', when: 'sectionAxis' },
      { name: 'PERFORMANCE_TYPE', when: 'always' },
    ],
  };
  return parseOrThrow(m);
}

/** Robot-shaped fixture: a headless variable template, no run vars. */
function robotFixture(): ToolManifest {
  const m = baseManifest();
  m.id = 'robot-framework';
  m.alias = 'robot';
  (m.projects as Record<string, unknown>).sectionAxis = false;
  m.run = { headlessVar: '--variable HEADLESS:{value}' };
  return parseOrThrow(m);
}

/** Playwright-shaped fixture: no run capability block at all. */
function playwrightFixture(): ToolManifest {
  const m = baseManifest();
  m.id = 'playwright';
  m.alias = 'pw';
  (m.projects as Record<string, unknown>).sectionAxis = false;
  return parseOrThrow(m);
}

// ---------------------------------------------------------------------------
// buildRunVarTokens — capability-driven task vars (KEY=VALUE)
// ---------------------------------------------------------------------------

describe('buildRunVarTokens — k6 (sectionAxis = true)', () => {
  const k6 = k6Fixture();

  it('emits both SECTION (sectionAxis) and PERFORMANCE_TYPE (always) in order', () => {
    const tokens = buildRunVarTokens(k6, { SECTION: 'auth', PERFORMANCE_TYPE: 'LOAD' });
    expect(tokens).toEqual(['SECTION=auth', 'PERFORMANCE_TYPE=LOAD']);
  });

  it('drops a var whose value is missing or empty', () => {
    expect(buildRunVarTokens(k6, { SECTION: '', PERFORMANCE_TYPE: 'STRESS' })).toEqual([
      'PERFORMANCE_TYPE=STRESS',
    ]);
    expect(buildRunVarTokens(k6, { PERFORMANCE_TYPE: 'PEAK' })).toEqual(['PERFORMANCE_TYPE=PEAK']);
  });

  it('returns [] when no values are supplied', () => {
    expect(buildRunVarTokens(k6, {})).toEqual([]);
  });
});

describe('buildRunVarTokens — sectionAxis gating', () => {
  it('omits a sectionAxis var when the tool has no section axis', () => {
    const m = baseManifest();
    (m.projects as Record<string, unknown>).sectionAxis = false;
    m.run = {
      vars: [
        { name: 'SECTION', when: 'sectionAxis' },
        { name: 'PERFORMANCE_TYPE', when: 'always' },
      ],
    };
    const tokens = buildRunVarTokens(parseOrThrow(m), {
      SECTION: 'auth',
      PERFORMANCE_TYPE: 'LOAD',
    });
    // SECTION is gated out; the always-var still emits.
    expect(tokens).toEqual(['PERFORMANCE_TYPE=LOAD']);
  });

  it('returns [] for a manifest with no run block (safe default)', () => {
    expect(buildRunVarTokens(playwrightFixture(), { SECTION: 'x' })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildHeadlessToken — capability-driven headless variable
// ---------------------------------------------------------------------------

describe('buildHeadlessToken — robot (headlessVar declared)', () => {
  const robot = robotFixture();

  it('local + headless → HEADLESS:True', () => {
    const ctx: RunnerContext = { mode: 'local', headless: true };
    expect(buildHeadlessToken(robot, ctx)).toBe('--variable HEADLESS:True');
  });

  it('local + headed → HEADLESS:False', () => {
    const ctx: RunnerContext = { mode: 'local', headless: false };
    expect(buildHeadlessToken(robot, ctx)).toBe('--variable HEADLESS:False');
  });

  it('local + unspecified → empty token', () => {
    const ctx: RunnerContext = { mode: 'local' };
    expect(buildHeadlessToken(robot, ctx)).toBe('');
  });

  it('docker forces HEADLESS:True regardless of headless flag (Requirement 4.12)', () => {
    expect(buildHeadlessToken(robot, { mode: 'docker' })).toBe('--variable HEADLESS:True');
    expect(buildHeadlessToken(robot, { mode: 'docker', headless: false })).toBe(
      '--variable HEADLESS:True',
    );
  });
});

describe('buildHeadlessToken — tools without a headlessVar', () => {
  it('returns "" for playwright (no run block) in local and docker', () => {
    const pw = playwrightFixture();
    expect(buildHeadlessToken(pw, { mode: 'local', headless: true })).toBe('');
    expect(buildHeadlessToken(pw, { mode: 'docker' })).toBe('');
  });

  it('returns "" for k6 (run block without headlessVar)', () => {
    const k6 = k6Fixture();
    expect(buildHeadlessToken(k6, { mode: 'local', headless: false })).toBe('');
    expect(buildHeadlessToken(k6, { mode: 'docker' })).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Assembled built-in command strings (local + docker + headless)
//
// Demonstrates how task 18 composes the capability tokens onto the manifest
// base command, reproducing the exact legacy strings for the built-ins.
// ---------------------------------------------------------------------------

describe('assembled command strings — built-in parity', () => {
  const k6 = k6Fixture();
  const robot = robotFixture();

  function assembleK6(env: 'local' | 'docker', section: string, perf: string): string {
    const base = `task k6:run-${env}`;
    const project = 'PROJECT=billing';
    const vars = buildRunVarTokens(k6, { SECTION: section, PERFORMANCE_TYPE: perf });
    return [base, project, ...vars].join(' ');
  }

  function assembleRobot(ctx: RunnerContext, tag: string): string {
    const base = `task robot:run-${ctx.mode}`;
    const taskArgs = ['TYPE=web', 'PROJECT=checkout', ...(tag ? [`TAG=${tag}`] : [])];
    const headless = buildHeadlessToken(robot, ctx);
    const cli = headless ? ` -- ${headless}` : '';
    return `${base} ${taskArgs.join(' ')}${cli}`;
  }

  it('k6 local', () => {
    expect(assembleK6('local', 'auth', 'LOAD')).toBe(
      'task k6:run-local PROJECT=billing SECTION=auth PERFORMANCE_TYPE=LOAD',
    );
  });

  it('k6 docker', () => {
    expect(assembleK6('docker', 'checkout', 'STRESS')).toBe(
      'task k6:run-docker PROJECT=billing SECTION=checkout PERFORMANCE_TYPE=STRESS',
    );
  });

  it('robot local headless', () => {
    expect(assembleRobot({ mode: 'local', headless: true }, '@smoke')).toBe(
      'task robot:run-local TYPE=web PROJECT=checkout TAG=@smoke -- --variable HEADLESS:True',
    );
  });

  it('robot local headed', () => {
    expect(assembleRobot({ mode: 'local', headless: false }, '')).toBe(
      'task robot:run-local TYPE=web PROJECT=checkout -- --variable HEADLESS:False',
    );
  });

  it('robot docker — forced headless', () => {
    expect(assembleRobot({ mode: 'docker' }, '@regression')).toBe(
      'task robot:run-docker TYPE=web PROJECT=checkout TAG=@regression -- --variable HEADLESS:True',
    );
  });
});
