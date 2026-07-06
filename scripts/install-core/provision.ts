// scripts/install-core/provision.ts
//
// Playwright offline browser-provisioning DECISION logic (install-and-
// provisioning-overhaul, C2, D2-A; Property 5/6, R7.1/7.2/7.4/7.7/7.8).
//
// PURE module: the precedence that `tools/playwright/Taskfile.yml`'s `setup`
// task applies lives here as ONE testable function, so the runtime decision and
// the Property 5 test exercise the SAME logic (no shell/TS drift — Pahāna). The
// Taskfile gathers the three inputs (the PLAYWRIGHT_DOWNLOAD_HOST mirror from
// env, the required revision parsed from `playwright install --dry-run`, and the
// revision already in PLAYWRIGHT_BROWSERS_PATH) and shells out to the `decide`
// CLI below — the same way the root `setup` target shells out to
// scripts/manifests/setup-planner.ts for its provisioning plan.

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The provisioning action chosen for a browser (design Data Models,
 * "Provisioning decision"). `reprovision` carries its reason so the Taskfile and
 * logs can explain why a present-but-different build was discarded.
 */
export type ProvisionAction =
  | { readonly kind: 'mirror' }
  | { readonly kind: 'reuse' }
  | { readonly kind: 'archive' }
  | { readonly kind: 'reprovision'; readonly reason: 'revision-mismatch' };

/** Inputs to the pure provision decision. */
export interface ProvisionInputs {
  /** PLAYWRIGHT_DOWNLOAD_HOST — an internal mirror, or null/blank when unset. */
  readonly mirrorHost: string | null;
  /** Revision required by the installed `@playwright/test` (from `--dry-run`). */
  readonly requiredRevision: string;
  /** Revision already present in PLAYWRIGHT_BROWSERS_PATH, or null when none. */
  readonly presentRevision: string | null;
}

/** A mirror host counts as configured only when non-null and non-blank. */
function isMirrorConfigured(mirrorHost: string | null): boolean {
  return mirrorHost !== null && mirrorHost.trim().length > 0;
}

/**
 * Decide how to provision a browser, by the fixed precedence (R7.1 > R7.2 >
 * R7.7). Pure — no I/O:
 *
 * 1. mirror configured → `mirror`
 * 2. else present === required → `reuse`
 * 3. else a different build is present → `reprovision` revision-mismatch
 * 4. else nothing present → `archive` (R7.7 manual archive)
 *
 * The safety invariant: the revision that ends
 * up on disk is ALWAYS `requiredRevision`. `reuse` is chosen only when the
 * present build already equals it, and every download/extract action installs
 * `requiredRevision` — never a mismatched build. See {@link effectiveRevision}.
 */
export function decideProvisionAction(inputs: ProvisionInputs): ProvisionAction {
  const { mirrorHost, requiredRevision, presentRevision } = inputs;
  if (isMirrorConfigured(mirrorHost)) return { kind: 'mirror' };
  if (presentRevision === requiredRevision) return { kind: 'reuse' };
  if (presentRevision !== null) return { kind: 'reprovision', reason: 'revision-mismatch' };
  return { kind: 'archive' };
}

/**
 * The browser revision that will be on disk AFTER the action runs:
 * - `reuse` keeps whatever is already present (`presentRevision`);
 * - every other action downloads/extracts `requiredRevision`.
 *
 * For a CORRECT decision this ALWAYS equals `requiredRevision`,
 * because `reuse` is only chosen when `presentRevision === requiredRevision`.
 * Exposed so the Taskfile/logs can name the effective revision without
 * re-deriving the rule.
 */
export function effectiveRevision(action: ProvisionAction, inputs: ProvisionInputs): string | null {
  return action.kind === 'reuse' ? inputs.presentRevision : inputs.requiredRevision;
}

/** A browser-provisioning attempt's outcome (used by {@link reportCoreInstall}). */
export interface BrowserProvisionOutcome {
  readonly ok: boolean;
  readonly message?: string;
}

/** How a Core_Tool_Set install is reported once browser provisioning has run. */
export interface CoreInstallReport {
  /** Core install success — a function of Core steps ONLY. */
  readonly coreOk: boolean;
  /** Whether browser provisioning failed — surfaced for reporting, not for Core. */
  readonly provisioningFailed: boolean;
  /** The provisioning failure message, when one occurred. */
  readonly provisioningMessage: string | undefined;
}

/**
 * Report a Core_Tool_Set install given the Core steps' own result and a browser-
 * provisioning outcome. Browser provisioning is NOT a Core member (Core = node,
 * pnpm, uv, task, pm2), so its outcome — success OR failure — is surfaced for
 * reporting but NEVER changes `coreOk`. This is the pure encoding of
 * Property 6: provisioning is non-fatal to the Core install. If `coreOk` ever
 * folded in the provisioning result, Property 6 would fail.
 */
export function reportCoreInstall(
  coreStepsOk: boolean,
  provision: BrowserProvisionOutcome,
): CoreInstallReport {
  return {
    coreOk: coreStepsOk,
    provisioningFailed: !provision.ok,
    provisioningMessage: provision.ok ? undefined : provision.message,
  };
}

// ── CLI: `decide` (shelled out to by tools/playwright/Taskfile.yml `setup`) ───
// Mirrors scripts/manifests/setup-planner.ts: the pure functions above are the
// single source of truth; this thin CLI just adapts env + argv → decision →
// stdout so the Taskfile shell can branch on the chosen action without
// re-implementing the precedence. The mirror endpoint is read from the
// PLAYWRIGHT_DOWNLOAD_HOST env var, never a hardcoded URL.
//
// usage: tsx provision.ts decide <requiredRevision> [presentRevision]
// - PLAYWRIGHT_DOWNLOAD_HOST is read from the environment (dotenvx-injected)
// - pass an empty/omitted presentRevision when no build is present
// - prints the chosen action kind on stdout

function emptyToNull(value: string | undefined): string | null {
  return value !== undefined && value.length > 0 ? value : null;
}

function cmdDecide(argv: readonly string[]): void {
  const [requiredRevision, presentRevision] = argv;
  const action = decideProvisionAction({
    mirrorHost: emptyToNull(process.env.PLAYWRIGHT_DOWNLOAD_HOST),
    requiredRevision: requiredRevision ?? '',
    presentRevision: emptyToNull(presentRevision),
  });
  process.stdout.write(`${action.kind}\n`);
}

function main(): void {
  const [, , mode, ...rest] = process.argv;
  if (mode === 'decide') {
    cmdDecide(rest);
  } else {
    process.stderr.write('usage: provision.ts decide <requiredRevision> [presentRevision]\n');
    process.exit(2);
  }
}

// Run the CLI only when executed directly (tsx provision.ts decide ...). When
// imported by a test or by the Taskfile's sibling code, the exported pure
// helpers are used directly, so this guard keeps main() from firing.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
