// scripts/install-core/effects.ts
//
// The default, real `InstallEffects` implementation: the "spawn" half of
// install-core (install-and-provisioning-overhaul, C5). It runs the fixed-constant
// invocations from `invocation.ts` with `execFileSync` (argv-form — never a
// shell) and reuses the setup-planner's `gatherToolSetupFacts` for folder-presence
// facts, so no decision or presence logic is duplicated.
//
// It depends only on a `workspaceRoot` passed in — no Fastify, no hub `config.js`,
// no scanner, no `withResync` — so the CLI and the Hub hook
// can both build it (or wrap it) without dragging in server-only concerns.

import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { gatherToolSetupFacts, type ToolSetupOutcome } from '../manifests/setup-planner.js';
import {
  buildDepsInstallInvocation,
  buildGitCloneInvocation,
  buildToolSetupInvocation,
  type ChildInvocation,
} from './invocation.js';
import type { InstallEffects } from './pipeline.js';

/** Pull the captured stderr (`stdio: 'pipe'`) off a failed `execFileSync`, else its message. */
function extractStderr(err: unknown): string {
  if (err && typeof err === 'object' && 'stderr' in err) {
    const stderr = (err as { stderr?: Buffer | string | null }).stderr;
    if (stderr) {
      const text = stderr.toString().trim();
      if (text.length > 0) return text;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

/** Run an invocation; throw an `Error` carrying captured stderr on a non-zero exit. */
function runOrThrow(inv: ChildInvocation, cwd: string): void {
  try {
    execFileSync(inv.file, [...inv.args], { ...inv.options, cwd });
  } catch (err) {
    throw new Error(extractStderr(err));
  }
}

/** Run an invocation; return its exit code (0 on success, the child status otherwise). */
function runForExitCode(inv: ChildInvocation, cwd: string): number {
  try {
    execFileSync(inv.file, [...inv.args], { ...inv.options, cwd });
    return 0;
  } catch (err) {
    const status = (err as { status?: number | null }).status;
    return typeof status === 'number' ? status : 1;
  }
}

/**
 * Build the real effects rooted at `workspaceRoot`.
 *
 * ponytail: `gatherFacts` scans every tool under `tools/` (via the planner's
 * `gatherToolSetupFacts`) and picks the one id, rather than re-implementing the
 * three folder-presence checks for a single tool. Reuse over a fork; the
 * scan is one `readdirSync` and N is tiny. Upgrade path if a single-tool install
 * ever hot-loops: add a per-id fact helper to `setup-planner.ts` and call it here.
 */
export function createDefaultEffects(workspaceRoot: string): InstallEffects {
  const toolDir = (id: string): string => path.join(workspaceRoot, 'tools', id);

  return {
    cloneRegistry: ({ id, gitUrl, ref }) =>
      runOrThrow(buildGitCloneInvocation({ id, gitUrl, ref }), workspaceRoot),

    gatherFacts: (id) => gatherToolSetupFacts(workspaceRoot).find((f) => f.id === id),

    installDeps: ({ id, manager }) => {
      const inv = buildDepsInstallInvocation(manager);
      runOrThrow(inv, inv.cwd === 'toolDir' ? toolDir(id) : workspaceRoot);
    },

    runSetup: ({ id }): ToolSetupOutcome => ({
      id,
      exitCode: runForExitCode(buildToolSetupInvocation(id), workspaceRoot),
    }),
  };
}
