import type { TestSummary } from '@hub/shared';

// ---------------------------------------------------------------------------
// Tag levels — used for AND/OR semantics + Playwright grep expression.
//
// IMPORTANT: case-id is intentionally folded into the 'product' level so that
// `[@TA-C001, @cattle]` becomes "@TA-C001 OR @cattle" (run that specific TA
// test plus any cattle test) instead of an impossible AND constraint.
//
// 'loop' exists so loop tags can be found in their own picker group. It is a
// DISPLAY level only: for selection it folds back into 'product', because
// picking a loop case plus a domain case must still mean "run both" — an AND
// there matches nothing, which reads as a broken picker.
// ---------------------------------------------------------------------------

export type TagLevel = 'severity' | 'device' | 'flow' | 'test-type' | 'loop' | 'product';

const SEVERITY_TAGS = new Set(['@critical', '@high', '@medium', '@low']);
const DEVICE_TAGS = new Set(['@desktop', '@tablet', '@mobile']);
const FLOW_TAGS = new Set(['@positive', '@negative']);
const TEST_TYPE_TAGS = new Set(['@functional', '@e2e', '@regression', '@api', '@security', '@rpa']);

/**
 * A loop tag carries LOOP as a whole `_`/`-` delimited segment — the two shapes
 * projects emit are `@<PREFIX>_LOOP` (multi-test, e.g. `@TA_INTER_FAMILY_LOOP`)
 * and `@<PREFIX>_LOOP-C<nnn>` (one case, e.g. `@TA_INTER_FAMILY_LOOP-C003`).
 * The rule is about the LOOP segment, never a project's prefix, so any project's
 * loop tags land here; a word that merely starts with it (`@LOOPBACK_AUTH`) does
 * not qualify.
 */
const LOOP_TAG_RE = /(?:^@?|[_-])LOOP(?:$|[_-])/i;

export function getTagLevel(tag: string): TagLevel {
  if (SEVERITY_TAGS.has(tag)) return 'severity';
  if (DEVICE_TAGS.has(tag)) return 'device';
  if (FLOW_TAGS.has(tag)) return 'flow';
  if (TEST_TYPE_TAGS.has(tag)) return 'test-type';
  if (LOOP_TAG_RE.test(tag)) return 'loop';
  return 'product'; // domain tags + case-ids share this level (OR)
}

/**
 * Level used for AND/OR semantics, where 'loop' collapses into 'product'. The
 * picker shows loop tags apart; selecting them behaves exactly as before, so a
 * loop case and a domain case still OR into one run.
 */
function selectionLevel(tag: string): TagLevel {
  const level = getTagLevel(tag);
  return level === 'loop' ? 'product' : level;
}

// ---------------------------------------------------------------------------
// Matching — AND between levels, OR within levels.
// ---------------------------------------------------------------------------

/**
 * Match tests against selection.
 * - AND between levels (must satisfy all selected levels)
 * - OR within a level (must satisfy at least one tag in that level)
 *
 * Example: [@critical, @desktop, @DAIRY_CATTLE-C001, @DAIRY_CATTLE-C002]
 * -> tests that are (@critical) AND (@desktop) AND (C001 OR C002)
 */
export function matchTests(tests: TestSummary[], selected: string[]): TestSummary[] {
  if (selected.length === 0) return tests;

  const byLevel = new Map<TagLevel, string[]>();
  for (const tag of selected) {
    const level = selectionLevel(tag);
    const list = byLevel.get(level) ?? [];
    list.push(tag);
    byLevel.set(level, list);
  }

  return tests.filter((t) => {
    for (const [, levelTags] of byLevel) {
      if (!levelTags.some((tag) => t.tags.includes(tag))) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Tag expression builder for Playwright grep.
// ---------------------------------------------------------------------------

/**
 * Build a Playwright-compatible grep expression.
 * AND between levels, OR within levels.
 *
 * Examples:
 *   [@critical] -> `(?=.*@critical)`
 *   [@critical, @desktop] -> `(?=.*@critical)(?=.*@desktop)`
 *   [@C001, @C002] -> `(?=.*(?:@C001|@C002))`
 */
export function buildTagExpr(selected: string[]): string | undefined {
  if (selected.length === 0) return undefined;

  const byLevel = new Map<TagLevel, string[]>();
  for (const tag of selected) {
    const level = selectionLevel(tag);
    const list = byLevel.get(level) ?? [];
    list.push(tag);
    byLevel.set(level, list);
  }

  const parts: string[] = [];
  for (const [, levelTags] of byLevel) {
    if (levelTags.length === 1) {
      parts.push(`(?=.*${levelTags[0]})`);
    } else {
      parts.push(`(?=.*(?:${levelTags.join('|')}))`);
    }
  }
  return parts.join('');
}

/**
 * Inverse of {@link buildTagExpr}: decompose a saved grep expression back into a
 * flat list of tags, used when an edit/bookmark/schedule is re-opened. Now the
 * single source in `@hub/shared` (server flaky uses the same one),
 * re-exported here so existing `~/utils/tag-selection` importers keep working.
 */
export { parseTagExpr } from '@hub/shared';
