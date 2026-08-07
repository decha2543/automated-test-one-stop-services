// @ts-check
/**
 * The `.env.template` contract gate (scripts/lib/env-contract.mjs).
 *
 * steering `portability-and-config` §1 says the committed `.env.template` is the
 * single contract of what is tunable. These cases pin the scanner that enforces
 * it: every env read the code performs must be declared at one of the three
 * levels (project / tool / scripts), or come from the runner.
 *
 * Fixture-based on purpose — the real `tools/*` projects live in their own git
 * repos and are absent from a CI checkout, so asserting against them would make
 * this suite pass or fail for reasons unrelated to the scanner.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { auditWorkspace, collectEnvRefs, declaredKeys } from '../lib/env-contract.mjs';

/**
 * Build a throwaway workspace.
 * @param {{project?: string, tool?: string, scripts?: string, files?: Record<string, string>}} spec
 */
function makeWorkspace(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'env-contract-'));
  const projectDir = path.join(root, 'tools', 'playwright', 'projects', 'web', 'my-project');
  fs.mkdirSync(path.join(projectDir, 'automations', 'modules'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  const write = (p, text) => fs.writeFileSync(p, text, 'utf8');
  if (spec.project !== undefined) write(path.join(projectDir, '.env.template'), spec.project);
  if (spec.tool !== undefined) {
    write(path.join(root, 'tools', 'playwright', '.env.template'), spec.tool);
  }
  if (spec.scripts !== undefined) write(path.join(root, 'scripts', '.env.template'), spec.scripts);
  for (const [rel, text] of Object.entries(spec.files ?? {})) {
    const full = path.join(projectDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    write(full, text);
  }
  return { root, projectDir, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('collectEnvRefs finds every runtime syntax and records path:line', () => {
  // The Robot fixture carries only the %{...} side: a Robot file's variable
  // column is not an env read, and the scanner never looks at it.
  const { projectDir, cleanup } = makeWorkspace({
    files: {
      'automations/modules/a.ts':
        "const u = process.env.APP_USER;\nconst p = process.env['APP_PW'];",
      'automations/modules/b.ts': 'const base = __ENV.BASE_URL;',
      'automations/modules/c.resource': '%{ROBOT_A}\n%{ROBOT_B=fallback}',
    },
  });
  try {
    const refs = collectEnvRefs(projectDir);
    assert.deepEqual(
      [...refs.keys()].sort(),
      ['APP_PW', 'APP_USER', 'BASE_URL', 'ROBOT_A', 'ROBOT_B'],
      'a default value in %{KEY=default} does not exempt the key',
    );
    assert.deepEqual(refs.get('APP_USER'), ['automations/modules/a.ts:1']);
  } finally {
    cleanup();
  }
});

test('declaredKeys reads KEY= lines and ignores comments and blanks', () => {
  const { root, cleanup } = makeWorkspace({
    project: 'A=""\n# B="" commented out\n\nC="x"  # note',
  });
  try {
    const keys = declaredKeys(
      path.join(root, 'tools', 'playwright', 'projects', 'web', 'my-project', '.env.template'),
    );
    assert.deepEqual([...keys].sort(), ['A', 'C']);
  } finally {
    cleanup();
  }
});

test('a key declared in the project template is satisfied', () => {
  const { root, cleanup } = makeWorkspace({
    project: 'APP_USER=""',
    files: { 'automations/modules/a.ts': 'const u = process.env.APP_USER;' },
  });
  try {
    assert.deepEqual(auditWorkspace(root)[0].missing, []);
  } finally {
    cleanup();
  }
});

test('the tool and scripts templates also satisfy a key — one contract, three levels', () => {
  const { root, cleanup } = makeWorkspace({
    tool: 'PLAYWRIGHT_DOWNLOAD_HOST=""',
    scripts: 'SPREADSHEET_ID=""',
    files: {
      'automations/modules/a.ts':
        'const h = process.env.PLAYWRIGHT_DOWNLOAD_HOST;\nconst s = process.env.SPREADSHEET_ID;',
    },
  });
  try {
    assert.deepEqual(auditWorkspace(root)[0].missing, []);
  } finally {
    cleanup();
  }
});

test('an undeclared key is reported with its reference, and runner-provided keys are not', () => {
  const { root, cleanup } = makeWorkspace({
    project: 'BASE_URL=""',
    files: {
      'automations/modules/a.ts':
        'const b = process.env.BASE_URL;\nconst s = process.env.SECRET_TOKEN;\nconst c = process.env.CI;',
    },
  });
  try {
    const [result] = auditWorkspace(root);
    assert.deepEqual(
      result.missing.map((m) => m.key),
      ['SECRET_TOKEN'],
      'CI comes from the runner, BASE_URL is declared',
    );
    assert.deepEqual(result.missing[0].refs, ['automations/modules/a.ts:2']);
    assert.equal(result.id, 'playwright/web/my-project');
  } finally {
    cleanup();
  }
});
