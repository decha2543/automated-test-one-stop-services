# Tool Plugin Template

Use this folder as a starting point when creating a new portable tool plugin.

## Quick start

1. Copy `tool-template-example/` → `tools/<your-tool-id>/`
2. Rename all `my-tool` / `mt` references to your tool's id and alias
3. Edit `tool.manifest.json` — this is the single source of truth
4. Create at least one `*-template-example` project under `projects/`
5. Implement `Taskfile.yml` run targets (`run-local`, `run-docker`)
6. Run `task default` from the workspace root — your tool is now wired

## What's common across all tools (derived from playwright, robot, k6)

| File | Purpose | Required? |
|---|---|---|
| `tool.manifest.json` | Single source of truth — tool identity, projects layout, runner config, pipeline, docker | **Yes** |
| `Taskfile.yml` | Task runner targets (`run-local`, `run-docker`, tags, etc.) | **Yes** |
| `docker-compose.template.yml` | Docker anchor template — `docker-compose.yml` is generated | **Yes** |
| `.gitignore` | Standalone repo ignore rules | **Yes** |
| `.gitattributes` | Enforces LF line endings on checkout (cross-OS); prevents CRLF breaking generated artefacts | **Yes** |
| `Dockerfile` | Image build (skip if using upstream image like k6→grafana/k6) | Conditional |
| `package.json` | Node/pnpm tools | If runtime=node |
| `pnpm-workspace.yaml` | Node tools with native build deps — declares `allowBuilds` under isolated `--ignore-workspace` install | If runtime=node + native deps |
| `pyproject.toml` | Python/uv tools | If runtime=python |
| `tsconfig.template.json` | TypeScript tools with `tsconfigGen` set | If tsconfigGen≠null |
| `biome.json` | Per-tool lint overrides (node tools) | Optional |
| `.dockerignore` | Docker build exclusions | Optional |
| `resources/` | Shared fixtures/helpers/modules across projects | Recommended |
| `projects/<type>/<name>-template-example/` | Scaffold for `Create project` | **Yes** (≥1) |

## Folder structure

```text
tools/<your-tool-id>/
├── .gitignore
├── tool.manifest.json          ← source of truth
├── Taskfile.yml                ← runner targets
├── Dockerfile                  ← (if building own image)
├── docker-compose.template.yml ← anchor template
├── package.json / pyproject.toml
├── resources/                  ← shared modules
└── projects/
    └── <type>/
        └── <tool>-<type>-template-example/
            ├── .env.template
            └── automations/
                ├── specs/      ← test specs
                ├── modules/    ← page objects / keywords
                └── tests-data/ ← test data
```

## Key manifest fields to customize

| Field | What to set |
|---|---|
| `id` | Must match folder name (`tools/<id>/`) |
| `alias` | Short prefix for `task <alias>:run-local` (unique) |
| `runtime` | `node` / `python` / `binary` |
| `packageManager` | `pnpm` / `uv` / `none` |
| `projects.depth` | `2` = type/project, `1` = flat (project only) |
| `projects.typeAxis` | `true` if tool has types (web/api/...) |
| `projects.fixedType` | Set when `typeAxis: false` (e.g. `"performance"`) |
| `projects.sectionAxis` | `true` if projects have sub-sections (k6) |
| `runner.taskNamespace` | Same as `alias` |
| `runner.steps` | Interactive prompts for the CLI runner |
| `compose.anchor` | Must match the YAML anchor name in the template |
| `docker.baseImage` | Image used by delivery/CI |

## After creation

- The scanner picks up the tool automatically (manifest-driven)
- Hub pages (Projects, Create, Clone, Run, Dashboard) show it
- `task default` regenerates compose/tsconfig/pipeline.json
- No central script edits needed
