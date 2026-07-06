// scripts/manifests/runner-step-render.ts
//
// Interactive step renderer for the runner prompt loop (design §4.3.3). Each
// declarative `manifest.runner.steps[]` entry is turned into a `prompts(...)`
// call here, isolating ALL interactive IO from the pure command builder in
// `runner-command.ts`. The runner (task 12) drives the loop, calls
// `runPreAction` + `renderStep` per step, and feeds the collected answers into
// `buildTaskCommand`.
//
// Two sentinels travel back to the loop:
//   - `BACK_SENTINEL` — the user chose `< Go Back` (select / selectDirs) or
//     typed the `<` back token (text). The loop rewinds one step.
//   - the empty string is a legitimate answer (e.g. headless mode value `''`),
//     never a back signal.
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import prompts from 'prompts';
import { listDirs } from './fs-helpers.js';
import { substitute } from './runner-command.js';
import type {
  ToolManifest,
  ToolRunnerSelectDirsStep,
  ToolRunnerSelectStep,
  ToolRunnerStep,
  ToolRunnerTextStep,
} from './types.js';

/** Returned by a render call when the user asks to go back one step. */
export const BACK_SENTINEL = Symbol('runner.back');

/** Choice value used internally for the synthesized `< Go Back` select option. */
const BACK_VALUE = '__BACK__';

/** Text-prompt token a user types to go back, mirroring the legacy runner. */
const BACK_TEXT = '<';

/** A render outcome: a concrete answer string, or the go-back sentinel. */
export type RenderResult = string | typeof BACK_SENTINEL;

/**
 * Render a single step by dispatching on its `kind`. Pure orchestration around
 * the per-kind renderers below; the loop owns `when` filtering and rewind.
 */
export function renderStep(
  step: ToolRunnerStep,
  manifest: ToolManifest,
  workspaceRoot: string,
  answers: Readonly<Record<string, string>>,
): Promise<RenderResult> {
  switch (step.kind) {
    case 'selectDirs':
      return renderSelectDirs(step, manifest, workspaceRoot, answers);
    case 'select':
      return renderSelect(step);
    case 'text':
      return renderText(step);
  }
}

/**
 * Run a step's `preAction` shell command (e.g. printing available tags before
 * the tag prompt). Tokens `{ns}` and any answer key are substituted in. No-op
 * when the step declares no `preAction`. Inherits stdio so output is live.
 */
export function runPreAction(
  step: ToolRunnerStep,
  manifest: ToolManifest,
  answers: Readonly<Record<string, string>>,
): void {
  if (step.preAction === undefined) return;
  const command = substitute(step.preAction, {
    ns: manifest.runner.taskNamespace,
    ...answers,
  });
  spawnSync(command, { shell: true, stdio: 'inherit' });
}

/**
 * Render a `selectDirs` step: list immediate sub-directories of the resolved
 * `from` path (with `{token}` answers substituted), optionally excluding names
 * matching the `exclude` glob, and present them plus a `< Go Back` option.
 */
export async function renderSelectDirs(
  step: ToolRunnerSelectDirsStep,
  manifest: ToolManifest,
  workspaceRoot: string,
  answers: Readonly<Record<string, string>>,
): Promise<RenderResult> {
  const toolDir = path.join(workspaceRoot, 'tools', manifest.id);
  const fromPath = path.join(toolDir, substitute(step.from, answers));

  let dirs = listDirs(fromPath);
  if (step.exclude !== undefined) {
    const matcher = globToRegex(step.exclude);
    dirs = dirs.filter((d) => !matcher.test(d));
  }

  const res = await prompts({
    type: 'select',
    name: step.id,
    message: step.title,
    choices: [
      ...dirs.map((d) => ({ title: d, value: d })),
      { title: '< Go Back', value: BACK_VALUE },
    ],
  });
  return interpretSelect(res[step.id]);
}

/**
 * Render a `select` step from the manifest-declared choices, appending a
 * `< Go Back` option. Choice values may be empty strings (e.g. headless mode);
 * those are returned verbatim and are NOT treated as a back signal.
 */
export async function renderSelect(step: ToolRunnerSelectStep): Promise<RenderResult> {
  const res = await prompts({
    type: 'select',
    name: step.id,
    message: step.title,
    choices: [
      ...step.choices.map((c) => ({ title: c.title, value: c.value })),
      { title: '< Go Back', value: BACK_VALUE },
    ],
  });
  return interpretSelect(res[step.id]);
}

/**
 * Render a `text` step. An empty entry is a valid answer (means "all"); the
 * `<` token or a cancelled prompt (undefined) maps to the back sentinel.
 */
export async function renderText(step: ToolRunnerTextStep): Promise<RenderResult> {
  const res = await prompts({
    type: 'text',
    name: step.id,
    message: step.title,
    initial: step.initial,
  });
  const value = res[step.id];
  if (value === undefined || value === BACK_TEXT) return BACK_SENTINEL;
  return String(value);
}

/** Map a raw select answer to a `RenderResult`, honouring the back sentinel. */
function interpretSelect(value: unknown): RenderResult {
  if (value === undefined || value === BACK_VALUE) return BACK_SENTINEL;
  return String(value);
}

/**
 * Convert a shell-style glob (only `*` is significant, as in
 * `*-template-example`) to an anchored `RegExp`. All other regex metacharacters
 * are escaped so the match is literal.
 */
function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}
