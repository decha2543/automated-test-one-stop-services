// scripts/manifests/pipeline-projection.ts
//
// Projects the enabled tool manifests into the `config/pipeline.json`
// shape consumed by every agent skill (Auto, TCD, Defect, Delivery, …).
//
// `pipeline.json` is option B from design §4.5: a *generated projection* of
// manifest data rather than a separate source of truth. Agents keep their
// current contract; this module just composes each enabled tool's
// `manifest.pipeline.*` into the familiar section layout.
//
// The static (manifest-independent) sections — `routing` and `id_conventions`
// — live in `config/pipeline.static.json` and are spread in verbatim
// via `staticParts`. See design §4.5.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ManifestRegistry } from './index.js';

/**
 * Token inside a manifest's `pipeline.envToken` that stands in for an env-var
 * name. It is replaced by `ENV_KEY_SAMPLE` so the generated `env_injection`
 * section reads the same way the hand-authored `pipeline.json` always has —
 * e.g. `process.env.{KEY}` → `process.env.ENV_X`, `%{{KEY}}` → `%{ENV_X}`,
 * `__ENV.{KEY}` → `__ENV.ENV_X`. See design §3.3–§3.5 and req 5 byte-identity.
 */
const ENV_KEY_PLACEHOLDER = '{KEY}';
const ENV_KEY_SAMPLE = 'ENV_X';

/** Default location of the static-parts file, relative to the workspace root. */
const PIPELINE_STATIC_PATH = path.join('config', 'pipeline.static.json');

/**
 * Section-level `_comment` strings baked into the projection. These mirror the
 * historical `pipeline.json` so the generated file stays self-documenting for
 * the agents that read it. They are manifest-independent constants, distinct
 * from the static `routing` / `id_conventions` sections (which are data).
 */
const SECTION_COMMENTS = {
  top: 'GENERATED FROM tool.manifest.json — do not edit by hand. Regenerated each `task`.',
  targetPaths: 'Where Auto writes specs. <kind> ∈ positive|negative|edge|api.',
  runCommands: 'ALWAYS use `task`. Never raw playwright/robot/k6 CLI.',
  envInjection:
    'How each framework reads env vars. Playwright + k6 auto-load .env via dotenvx through task; Robot inherits process env.',
  artifactPaths:
    'Where run outputs land (used by delivery for CI artifact collection). git-ignored under outputs/.',
  dockerBaseImages:
    'delivery (CI/CD) base images. Read Playwright version from tools/playwright/package.json — do not hardcode.',
} as const;

/** Naming-convention legend embedded inside the `env_injection` section. */
const ENV_NAMING = {
  'ENV_MOCK_*': 'fake test data (usernames, passwords, IDs, emails)',
  'ENV_*': 'config (ENV_BASE_URL, ENV_API_KEY)',
  secret_placeholder: 'PLACEHOLDER - inject via CI/CD secrets',
} as const;

/**
 * Manifest-independent sections spread verbatim into the projection. Sourced
 * from `config/pipeline.static.json`. Kept as `unknown` because their
 * internal shape is owned by the agents that consume them, not by this module.
 */
export interface PipelineStaticParts {
  readonly routing: unknown;
  readonly id_conventions: unknown;
}

/**
 * The full generated `pipeline.json` shape. Section keys mirror the historical
 * file exactly so existing skills do not change when manifests become the
 * source of truth. See design §4.5.
 */
export interface PipelineProjection {
  readonly _comment: string;
  readonly _generated: { readonly from: 'tool.manifest.json'; readonly at: string };
  readonly routing: unknown;
  readonly target_paths: Readonly<Record<string, string>>;
  readonly run_commands: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly env_injection: Readonly<Record<string, string>> & { readonly naming: unknown };
  readonly id_conventions: unknown;
  readonly artifact_paths: Readonly<Record<string, readonly string[]>>;
  readonly docker_base_images: Readonly<Record<string, string>>;
}

/** Substitute the `{KEY}` placeholder in an env token with the sample env name. */
function projectEnvToken(envToken: string): string {
  return envToken.split(ENV_KEY_PLACEHOLDER).join(ENV_KEY_SAMPLE);
}

/**
 * Compose the enabled tools in `registry` into a `PipelineProjection`.
 *
 * Composed-key rule for `target_paths` (design §4.5, req 5.4 / 5.5):
 *   - a `default` pipeline key → the bare tool id (`<id>`)
 *   - any other key            → `<id>_<key>` (e.g. `playwright_web`)
 *
 * Iteration follows `registry.enabled()`, whose order is the discovery sort
 * order, so the projection is deterministic and order-independent (req 2.3).
 * Disabled tools are absent from `enabled()` and therefore omitted from every
 * section (req 5.6).
 */
export function projectPipeline(
  registry: ManifestRegistry,
  staticParts: PipelineStaticParts,
): PipelineProjection {
  const targetPaths: Record<string, unknown> = { _comment: SECTION_COMMENTS.targetPaths };
  const runCommands: Record<string, unknown> = { _comment: SECTION_COMMENTS.runCommands };
  const envInjection: Record<string, unknown> = {
    _comment: SECTION_COMMENTS.envInjection,
    naming: ENV_NAMING,
  };
  const dockerBase: Record<string, unknown> = { _comment: SECTION_COMMENTS.dockerBaseImages };
  const artifactPaths: Record<string, unknown> = { _comment: SECTION_COMMENTS.artifactPaths };

  for (const tool of registry.enabled()) {
    const p = tool.pipeline;
    for (const [key, template] of Object.entries(p.targetPaths)) {
      const composedKey = key === 'default' ? p.id : `${p.id}_${key}`;
      targetPaths[composedKey] = template;
    }
    runCommands[p.id] = { ...p.runCommands };
    envInjection[p.id] = projectEnvToken(p.envToken);
    dockerBase[p.id] = `${tool.docker.baseImage} (+ ${tool.docker.extras.join(', ')})`;
    artifactPaths[p.id] = [...p.artifactPaths];
  }

  const projection: Record<string, unknown> = {
    _comment: SECTION_COMMENTS.top,
    _generated: { from: 'tool.manifest.json', at: new Date().toISOString() },
    ...staticParts,
    target_paths: targetPaths,
    run_commands: runCommands,
    env_injection: envInjection,
    artifact_paths: artifactPaths,
    docker_base_images: dockerBase,
  };

  return projection as unknown as PipelineProjection;
}

/**
 * Read `config/pipeline.static.json` from `workspaceRoot`. Returns
 * empty `routing` / `id_conventions` objects when the file is absent so callers
 * can still generate a (partial) pipeline.json rather than crashing.
 */
export function loadPipelineStatic(workspaceRoot: string): PipelineStaticParts {
  const staticPath = path.join(workspaceRoot, PIPELINE_STATIC_PATH);
  if (!fs.existsSync(staticPath)) {
    return { routing: {}, id_conventions: {} };
  }
  const raw = fs.readFileSync(staticPath, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return { routing: parsed.routing ?? {}, id_conventions: parsed.id_conventions ?? {} };
}
