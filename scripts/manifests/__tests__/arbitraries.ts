// scripts/manifests/__tests__/arbitraries.ts
//
// fast-check arbitraries for `ToolManifest` and supporting shapes.
// Used exclusively by `properties.spec.ts` to generate valid
// ToolManifest-shaped objects for property-based tests (design §9).
//
// All arbitraries are exported for reuse across property tests.
import * as fc from 'fast-check';
import type { ToolManifest, ToolPackageManager, ToolRunnerStep, ToolRuntime } from '../types.js';

// ── Alphabet helpers ──────────────────────────────────────────────────────────

/** `^[a-z][a-z0-9-]+$` — ToolId pattern */
const arbId: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'k', 'm', 'n', 'p', 'r', 's', 't'),
    fc.stringMatching(/^[a-z0-9-]{1,10}$/),
  )
  .map(([head, tail]) => `${head}${tail}`);

/** `^[a-z][a-z0-9]*$` — ToolAlias pattern (no hyphens) */
const arbAlias: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'k', 'm', 'n'),
    fc.stringMatching(/^[a-z0-9]{0,6}$/),
  )
  .map(([head, tail]) => `${head}${tail}`);

/** `^[a-z][a-z0-9-]*$` — taskNamespace pattern */
const arbNamespace: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('n', 'p', 'q', 'r', 's', 'u', 'v', 'w', 'x', 'y', 'z'),
    fc.stringMatching(/^[a-z0-9-]{0,8}$/),
  )
  .map(([head, tail]) => `${head}${tail}`);

/** `^[a-z][a-z0-9-]*$` — docker network name */
const arbNetworkName: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom('net', 'shared', 'bridge', 'ext'), fc.stringMatching(/^[a-z0-9]{0,4}$/))
  .map(([base, suffix]) => `${base}${suffix}`);

/** `^[A-Z][A-Z0-9_]*$` — passAs.task key */
const arbTaskKey: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('A', 'B', 'C', 'D', 'E', 'P', 'Q', 'R', 'S', 'T'),
    fc.stringMatching(/^[A-Z0-9_]{0,8}$/),
  )
  .map(([head, tail]) => `${head}${tail}`);

// ── PassAs ─────────────────────────────────────────────────────────────────────

const arbPassAs = fc.oneof(
  arbTaskKey.map((key) => ({ kind: 'task' as const, key })),
  fc.constant({ kind: 'cli' as const }),
  fc.constant({ kind: 'none' as const }),
);

// ── Runner steps ──────────────────────────────────────────────────────────────

const arbSelectDirsStep = (id: string): fc.Arbitrary<ToolRunnerStep> =>
  fc.record({
    kind: fc.constant('selectDirs' as const),
    id: fc.constant(id),
    title: fc.string({ minLength: 1, maxLength: 20 }),
    from: fc.constant('projects'),
    passAs: arbPassAs,
  }) as fc.Arbitrary<ToolRunnerStep>;

const arbSelectStep = (id: string): fc.Arbitrary<ToolRunnerStep> =>
  fc
    .array(
      fc.record({
        title: fc.string({ minLength: 1, maxLength: 10 }),
        value: fc.string({ maxLength: 10 }),
      }),
      { minLength: 1, maxLength: 4 },
    )
    .chain((choices) =>
      fc.record({
        kind: fc.constant('select' as const),
        id: fc.constant(id),
        title: fc.string({ minLength: 1, maxLength: 20 }),
        choices: fc.constant(choices),
        passAs: arbPassAs,
      }),
    ) as fc.Arbitrary<ToolRunnerStep>;

const arbTextStep = (id: string): fc.Arbitrary<ToolRunnerStep> =>
  fc.record({
    kind: fc.constant('text' as const),
    id: fc.constant(id),
    title: fc.string({ minLength: 1, maxLength: 20 }),
    passAs: arbPassAs,
  }) as fc.Arbitrary<ToolRunnerStep>;

/**
 * Generate an array of runner steps with guaranteed-unique `id` values.
 * Uses a pool of pre-seeded distinct identifiers to avoid refinement failures.
 */
const arbRunnerSteps: fc.Arbitrary<readonly ToolRunnerStep[]> = fc
  .integer({ min: 0, max: 4 })
  .chain((count) => {
    if (count === 0) return fc.constant([] as ToolRunnerStep[]);
    const idPool = ['sa', 'sb', 'sc', 'sd', 'se', 'sf', 'sg', 'sh', 'si', 'sj'];
    const ids = idPool.slice(0, count);
    const stepArbs = ids.map((id) =>
      fc.oneof(arbSelectDirsStep(id), arbSelectStep(id), arbTextStep(id)),
    );
    return fc
      .tuple(...(stepArbs as [fc.Arbitrary<ToolRunnerStep>, ...fc.Arbitrary<ToolRunnerStep>[]]))
      .map((steps) =>
        Array.isArray(steps) ? (steps as ToolRunnerStep[]) : [steps as ToolRunnerStep],
      );
  });

// ── Runner execution types ─────────────────────────────────────────────────────

const arbExecutionTypes = fc.array(
  fc.record({
    id: fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/),
    title: fc.string({ minLength: 1, maxLength: 20 }),
    commandTemplate: fc.constant('{ns}:run-{environment}'),
  }),
  { minLength: 1, maxLength: 3 },
);

// ── Projects config ──────────────────────────────────────────────────────────

const arbProjectsDepth1 = fc
  .string({ minLength: 1, maxLength: 10 })
  .filter((s) => /^[a-z][a-z0-9-]*$/.test(s))
  .map((fixedType) => ({
    root: 'projects',
    depth: 1 as const,
    typeAxis: false as const,
    fixedType,
    templates: { default: `projects/${fixedType}/tool-template-example` },
    specsSubdir: 'automations/specs',
    sectionAxis: false,
  }));

const arbProjectsDepth2 = fc.constant({
  root: 'projects',
  depth: 2 as const,
  typeAxis: true as const,
  fixedType: null,
  templates: {
    default: 'projects/web/tool-template-example',
    web: 'projects/web/tool-template-example',
  },
  specsSubdir: 'automations/specs',
  sectionAxis: false,
});

const arbProjects = fc.oneof(arbProjectsDepth1, arbProjectsDepth2);

// ── Full ToolManifest arbitrary ───────────────────────────────────────────────

/**
 * Generate a valid `ToolManifest`-shaped plain object.
 *
 * The `id` and `alias` are drawn independently; callers that need uniqueness
 * across manifests (e.g. Property 10) should filter or chain as needed.
 *
 * Used in design §9 correctness properties.
 */
export function arbToolManifest(): fc.Arbitrary<ToolManifest> {
  return fc
    .tuple(
      arbId,
      arbAlias,
      arbNamespace,
      arbProjects,
      arbRunnerSteps,
      arbExecutionTypes,
      fc.array(arbNetworkName, { minLength: 0, maxLength: 2 }),
      fc.constantFrom<ToolRuntime>('node', 'python', 'binary'),
      fc.constantFrom<ToolPackageManager>('pnpm', 'uv', 'none'),
      fc.boolean(),
    )
    .map(
      ([
        id,
        alias,
        taskNamespace,
        projects,
        steps,
        executionTypes,
        networks,
        runtime,
        packageManager,
        enabled,
      ]): ToolManifest => ({
        schemaVersion: '1',
        id: id as ToolManifest['id'],
        alias: alias as ToolManifest['alias'],
        title: `${id} tool`,
        description: `Generated manifest for ${id}`,
        version: '1.0.0',
        enabled,
        runtime,
        packageManager,
        taskfile: 'Taskfile.yml',
        projects,
        compose: {
          template: 'docker-compose.template.yml',
          anchor: `${id}-template`,
          networks,
        },
        tsconfigGen: null,
        docker: {
          baseImage: `docker.io/${id}:latest`,
          extras: ['task'],
        },
        runner: {
          taskNamespace,
          title: `${id} runner`,
          executionTypes,
          environments: ['local', 'docker'],
          commandTemplate: 'task {ns}:run-{environment}',
          steps,
        },
        pipeline: {
          id,
          targetPaths: {
            default: `tools/${id}/projects/{project}/automations/specs/{name}.spec.ts`,
          },
          envToken: 'process.env.{KEY}',
          runCommands: {
            local: `task ${taskNamespace}:run-local PROJECT=<name>`,
            docker: `task ${taskNamespace}:run-docker PROJECT=<name>`,
          },
          artifactPaths: [`outputs/${id}/{project}/`],
        },
      }),
    );
}

/**
 * Arbitrary for a pair of manifests with intentionally matching alias.
 * Used for Property 10 (alias collision → broken status).
 */
export function arbTwoManifestsSameAlias(): fc.Arbitrary<[ToolManifest, ToolManifest]> {
  return fc
    .tuple(arbAlias, arbId, arbId, arbNamespace, arbNamespace)
    .filter(([, idA, idB, nsA, nsB]) => idA !== idB && nsA !== nsB)
    .map(([alias, idA, idB, nsA, nsB]) => {
      const make = (id: string, ns: string): ToolManifest => ({
        schemaVersion: '1',
        id: id as ToolManifest['id'],
        alias: alias as ToolManifest['alias'],
        title: `${id} tool`,
        description: '',
        version: '1.0.0',
        enabled: true,
        runtime: 'node',
        packageManager: 'pnpm',
        taskfile: 'Taskfile.yml',
        projects: {
          root: 'projects',
          depth: 2,
          typeAxis: true,
          fixedType: null,
          templates: { default: `projects/web/${id}-web-template-example` },
          specsSubdir: 'automations/specs',
          sectionAxis: false,
        },
        compose: {
          template: 'docker-compose.template.yml',
          anchor: `${id}-template`,
          networks: [],
        },
        tsconfigGen: null,
        docker: { baseImage: `docker.io/${id}:latest`, extras: ['task'] },
        runner: {
          taskNamespace: ns,
          title: `${id} runner`,
          executionTypes: [{ id: 'run', title: 'Run', commandTemplate: '{ns}:run-{environment}' }],
          environments: ['local', 'docker'],
          commandTemplate: 'task {ns}:run-{environment}',
          steps: [],
        },
        pipeline: {
          id,
          targetPaths: { default: `tools/${id}/projects/{project}/specs/{name}.spec.ts` },
          envToken: 'process.env.{KEY}',
          runCommands: { local: `task ${ns}:run-local` },
          artifactPaths: [`outputs/${id}/`],
        },
      });
      return [make(idA, nsA), make(idB, nsB)] as [ToolManifest, ToolManifest];
    });
}

/**
 * Arbitrary for a pair of manifests with intentionally matching taskNamespace.
 * Used for Property 10 (namespace collision → broken status).
 */
export function arbTwoManifestsSameNamespace(): fc.Arbitrary<[ToolManifest, ToolManifest]> {
  return fc
    .tuple(arbNamespace, arbId, arbId, arbAlias, arbAlias)
    .filter(([, idA, idB, aliasA, aliasB]) => idA !== idB && aliasA !== aliasB)
    .map(([ns, idA, idB, aliasA, aliasB]) => {
      const make = (id: string, alias: string): ToolManifest => ({
        schemaVersion: '1',
        id: id as ToolManifest['id'],
        alias: alias as ToolManifest['alias'],
        title: `${id} tool`,
        description: '',
        version: '1.0.0',
        enabled: true,
        runtime: 'node',
        packageManager: 'pnpm',
        taskfile: 'Taskfile.yml',
        projects: {
          root: 'projects',
          depth: 2,
          typeAxis: true,
          fixedType: null,
          templates: { default: `projects/web/${id}-web-template-example` },
          specsSubdir: 'automations/specs',
          sectionAxis: false,
        },
        compose: {
          template: 'docker-compose.template.yml',
          anchor: `${id}-template`,
          networks: [],
        },
        tsconfigGen: null,
        docker: { baseImage: `docker.io/${id}:latest`, extras: ['task'] },
        runner: {
          taskNamespace: ns,
          title: `${id} runner`,
          executionTypes: [{ id: 'run', title: 'Run', commandTemplate: '{ns}:run-{environment}' }],
          environments: ['local', 'docker'],
          commandTemplate: 'task {ns}:run-{environment}',
          steps: [],
        },
        pipeline: {
          id,
          targetPaths: { default: `tools/${id}/projects/{project}/specs/{name}.spec.ts` },
          envToken: 'process.env.{KEY}',
          runCommands: { local: `task ${ns}:run-local` },
          artifactPaths: [`outputs/${id}/`],
        },
      });
      return [make(idA, aliasA), make(idB, aliasB)] as [ToolManifest, ToolManifest];
    });
}

// ── Folder-presence arbitraries (install-and-provisioning-overhaul) ───────────
// Drives the folder-presence discovery property (Property 1) and the gating
// properties (Property 2/3) that share the same `tools/` input space.

/** How a generated `tools/<name>/` folder is named on disk. */
export type ToolFolderKind = 'normal' | 'hidden' | 'template';

/** A single random `tools/` entry: a base token, a naming kind, and whether it
 * carries a `tool.manifest.json`. */
export interface ToolFolderSpec {
  readonly token: string;
  readonly kind: ToolFolderKind;
  readonly hasManifest: boolean;
}

/** The on-disk folder name for a spec: `.token` (hidden),
 * `token-template-example` (template), or `token` (normal). */
export function toolFolderName(spec: ToolFolderSpec): string {
  if (spec.kind === 'hidden') return `.${spec.token}`;
  if (spec.kind === 'template') return `${spec.token}-template-example`;
  return spec.token;
}

/**
 * A random set of `tools/<name>/` folder specs with unique tokens — a mix of
 * normal / `.`-hidden / `*-template-example` names, each with or without a
 * `tool.manifest.json`. Tokens are deduped so the derived folder names never
 * collide on disk (a token is `^[a-z][a-z0-9]{0,7}$`, so no token can contain a
 * `.` prefix or a `-template-example` suffix and clash across kinds).
 */
export function arbToolFolderSet(): fc.Arbitrary<readonly ToolFolderSpec[]> {
  return fc
    .array(
      fc.record({
        token: fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/),
        kind: fc.constantFrom<ToolFolderKind>('normal', 'hidden', 'template'),
        hasManifest: fc.boolean(),
      }),
      { maxLength: 8 },
    )
    .map((specs) => {
      const seen = new Set<string>();
      const unique: ToolFolderSpec[] = [];
      for (const spec of specs) {
        if (seen.has(spec.token)) continue;
        seen.add(spec.token);
        unique.push(spec);
      }
      return unique;
    });
}
