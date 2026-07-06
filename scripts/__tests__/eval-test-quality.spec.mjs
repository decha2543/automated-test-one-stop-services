// @ts-check
/**
 * Unit checks for the test-quality eval rubric (scripts/eval/test-quality.mjs).
 *
 * Mirrors the harness's own `--selftest`, but wired into the automated suite
 * (`node --test`) so a rubric regression is caught by `task test`, not only by
 * a manual `--selftest` run. Imports `scoreText` directly — the harness guards
 * its CLI entrypoint, so importing it has no filesystem side effect.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scoreText } from '../eval/test-quality.mjs';

test('a clean, well-tagged test scores 100', () => {
  const src =
    "import { expect } from '@playwright/test';\n// @TC-X-001\nexpect(page.getByRole('button')).toBeVisible();";
  assert.equal(scoreText(src, 'x.spec.ts').score, 100);
});

test('a hardcoded wait is penalised', () => {
  const src = 'await page.waitForTimeout(2000);\nexpect(x).toBe(1);\n// @REQ-1';
  const { score, findings } = scoreText(src, 'x.spec.ts');
  assert.equal(score, 85);
  assert.ok(findings.some((f) => f.includes('hardcoded-wait')));
});

test('missing assertion and missing traceability are both penalised', () => {
  const { score, findings } = scoreText('const x = 1;', 'x.spec.ts');
  assert.equal(score, 70);
  assert.ok(findings.some((f) => f.includes('missing-assertion')));
  assert.ok(findings.some((f) => f.includes('missing-traceability')));
});

test('a brittle locator (absolute xpath + nth) is flagged', () => {
  const src = "// @TC-1\nexpect(x).toBe(1);\nconst el = page.locator('//div[@id=\"a\"]').nth(3);";
  const { findings } = scoreText(src, 'x.spec.ts');
  assert.ok(findings.some((f) => f.includes('brittle-locator')));
});
