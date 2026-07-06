// scripts/install-tool.ts
//
// Headless install CLI with Hub parity (install-and-provisioning-overhaul, C5,
// D3-B; Requirements 9.1–9.5). Run via tsx, mirroring `scripts/runner.ts` /
// `scripts/create-project.ts`:
//
// tsx scripts/install-tool.ts <id> [--from-registry]
//
// It installs the tool's dependencies and then runs that tool's `setup` task by
// delegating to install-core's `runInstallPipeline` — the SAME deps + setup path
// the Hub Post_Install_Hook runs, so the CLI and the Hub produce the
// same outcome for the same tool by construction. The Hub hook's
// `task ... setup` command (`runToolSetupTask` in
// `hub/server/src/services/tool-plugins.ts`) is byte-identical to install-core's
// `buildToolSetupInvocation`, so command-level parity is verified by test 12.2.
//
// Trust boundary: the tool id is validated against `SAFE_ID`
// BEFORE any filesystem / git / network action — including before the registry
// file is read for `--from-registry`. A registry git URL is validated against
// `SAFE_GIT_URL` before the clone; that gate lives in the pipeline's `validate`
// stage (and again, defence-in-depth, in the clone invocation builder), so the
// CLI surfaces the pipeline's rejection rather than re-implementing it.
//
// On failure the CLI exits with a NON-ZERO status and names the failing stage
//. The stage→exit-code mapping is a small PURE function
// (`exitCodeForResult`) so it is property-testable without spawning a process.

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDefaultEffects,
  type InstallEffects,
  type InstallRequest,
  type InstallResult,
  type InstallStage,
  isSafeToolId,
  runInstallPipeline,
} from './install-core/index.js';
import { loadToolRegistry } from './manifests/index.js';

// ── Result shape (design Data Models §"CLI result", R9.4) ────────────────────
//
// Structurally identical to install-core's `InstallResult`, so the pipeline's
// result IS a `CliInstallResult` — no second shape to keep in sync.
export type CliInstallResult = InstallResult;

// ── Pure stage → process-exit-code mapping ────────────────────────────
//
// Distinct non-zero codes per failing stage so a headless caller can branch on
// the exit status, while satisfying the only invariant the property asserts:
// success → 0, any failure → non-zero. Kept pure (no I/O, no spawn) so Property
// 11 can drive it directly.
const STAGE_EXIT_CODE: Record<InstallStage, number> = {
  validate: 2,
  clone: 3,
  deps: 4,
  setup: 5,
};

/**
 * Derive the process exit code from a {@link CliInstallResult}: 0 on success,
 * the stage's distinct non-zero code on failure (a defensive `1` if a failure
 * ever lacks a stage). Pure — the testable half of R9.4.
 */
export function exitCodeForResult(result: CliInstallResult): number {
  if (result.ok) return 0;
  return result.failedStage !== undefined ? STAGE_EXIT_CODE[result.failedStage] : 1;
}

// ── Argument parsing ─────────────────────────────────────────────────────────

/** Parsed CLI arguments: the tool id and whether to install from the registry. */
export interface CliArgs {
  readonly id: string | undefined;
  readonly fromRegistry: boolean;
}

/**
 * Parse `tsx scripts/install-tool.ts <id> [--from-registry]`. The first non-flag
 * positional is the tool id; `--from-registry` is a boolean flag. Unknown flags
 * are ignored so the contract stays stable.
 */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  let id: string | undefined;
  let fromRegistry = false;
  for (const arg of argv) {
    if (arg === '--from-registry') {
      fromRegistry = true;
    } else if (!arg.startsWith('-') && id === undefined) {
      id = arg;
    }
  }
  return { id, fromRegistry };
}

// ── Request resolution (validation gate + registry lookup) ───────────────────

/** Either a ready-to-run pipeline request, or an early CLI result (pre-pipeline). */
type ResolvedRequest =
  | { readonly kind: 'request'; readonly request: InstallRequest }
  | { readonly kind: 'early'; readonly result: CliInstallResult };

/**
 * Validate the id and build the pipeline request. `SAFE_ID` is checked here,
 * BEFORE the registry file is read, so an invalid id never triggers any
 * filesystem / network action. For `--from-registry` the registry
 * entry's git URL + ref are resolved into a registry source; the pipeline then
 * validates the git URL against `SAFE_GIT_URL` before cloning.
 */
async function resolveRequest(args: CliArgs, workspaceRoot: string): Promise<ResolvedRequest> {
  const { id, fromRegistry } = args;

  if (id === undefined || id.length === 0) {
    return {
      kind: 'early',
      result: { ok: false, failedStage: 'validate', message: 'missing required <id> argument' },
    };
  }

  // Trust-boundary gate: reject before reading the registry or
  // touching the filesystem. The pipeline re-validates as defence in depth.
  if (!isSafeToolId(id)) {
    return {
      kind: 'early',
      result: {
        ok: false,
        failedStage: 'validate',
        message: `invalid tool id: ${JSON.stringify(id)}`,
      },
    };
  }

  if (!fromRegistry) {
    return { kind: 'request', request: { id, source: { kind: 'local' } } };
  }

  // --from-registry: resolve the entry (id already SAFE_ID-validated). The git
  // URL is validated by the pipeline's `validate` stage before any clone.
  const registry = await loadToolRegistry(workspaceRoot);
  const entry = registry.tools.find((e) => e.name === id);
  if (entry === undefined) {
    return {
      kind: 'early',
      result: {
        ok: false,
        failedStage: 'validate',
        message: `'${id}' is not in the tool registry`,
      },
    };
  }

  return {
    kind: 'request',
    request: { id, source: { kind: 'registry', gitUrl: entry.gitUrl, ref: entry.ref } },
  };
}

// ── Install (the delegation seam, R9.1/R9.2) ─────────────────────────────────

/**
 * Run a headless install by delegating to install-core's shared pipeline. This
 * is the ONLY install path the CLI has — it never re-implements deps/clone/setup
 * — so the CLI runs exactly the same deps + `setup` task as the Hub
 * Post_Install_Hook. `effects` is injected so tests can drive every stage
 * without spawning a process.
 */
export function installTool(request: InstallRequest, effects: InstallEffects): CliInstallResult {
  return runInstallPipeline(request, effects);
}

// ── Reporting ────────────────────────────────────────────────────────────────

/** Print a one-line outcome: success to stdout, the failing stage to stderr. */
function reportResult(result: CliInstallResult, id: string | undefined): void {
  const label = id ?? '<missing id>';
  if (result.ok) {
    process.stdout.write(`install-tool: '${label}' installed (deps + setup) successfully\n`);
    return;
  }
  const detail = result.message !== undefined ? `: ${result.message}` : '';
  process.stderr.write(
    `install-tool: '${label}' failed at stage '${result.failedStage}'${detail}\n`,
  );
}

// ── Entry point ──────────────────────────────────────────────────────────────

const currentDir =
  typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(currentDir, '..');

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const resolved = await resolveRequest(args, WORKSPACE_ROOT);

  const result: CliInstallResult =
    resolved.kind === 'early'
      ? resolved.result
      : installTool(resolved.request, createDefaultEffects(WORKSPACE_ROOT));

  reportResult(result, args.id);
  process.exit(exitCodeForResult(result));
}

// Run main() only when executed directly (tsx scripts/install-tool.ts ...), not
// when imported by a test — mirrors the guard in scripts/manifests/setup-planner.ts
// so importing this module to unit-test its pure helpers never spawns a process.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    process.stderr.write(`install-tool: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
