# Hub

Web UI for the Automated Test One-Stop Service workspace. Wraps the `task` CLI behind a browser-based control panel so users can create projects, run tests, view reports, and manage environments without touching the terminal.

## Quick start

```bash
task hub          # start dev (server + client)
task hub-build    # production build
task hub-start    # serve production bundle
```

Default ports:

- Client (Vite dev): http://localhost:5173
- Server (Fastify): http://localhost:5174

## Architecture

```
hub/
├── shared/    @hub/shared  → DTOs, types, and single-source taxonomies shared between server & client
├── server/    @hub/server  → Fastify 5 + WebSocket + embedded SQLite + project scanner + process runner + scheduler
└── client/    @hub/client  → React 19 + Vite + Mantine + xterm.js + TanStack Router/Query
```

## Features

### Run & monitor

- **Run** — pick tool / type / project / tags (multi-select, auto-categorized) / headed-headless / mode (local or Docker) / extra args
- **Live Output** — xterm.js terminal streamed over WebSocket, with cancel and reconnect to in-flight runs
- **Run queue** — bounded concurrency (configurable in Settings); queued runs surface in the UI
- **Schedules** — cron-based scheduled runs with a calendar view
- **Active-run reconnect** — a floating window + banner keep live runs visible across pages

### Results & analysis

- **Dashboard** — doctor status, project counts, run heatmap, trend chart, top projects, needs-attention widget
- **Reports** — filter / sort / status table, open the HTML report, rerun; severity-weighted pass score
- **History** — full run history with pass %, severity breakdown, and triggered-by
- **Insights** — flaky-test detection and k6 performance trends (tabbed)
- **Artifacts** — browse and download per-run artifacts (traces, videos, logs)

### Manage

- **Projects** — list / create / clone projects per tool & type (manifest-driven)
- **Env Editor & Env Profiles** — edit project & scripts `.env`; save and apply reusable env profiles
- **Docker Services** — status and control of the per-tool compose stacks (Appium, InfluxDB, Grafana)
- **Webhooks** — outbound notifications on run events
- **Doctor** — installation status (node, pnpm, uv, task, k6, docker, etc.) with an ordered install gate
- **Settings** — theme, EN/TH language, sound, concurrency, run defaults, output retention + auto-cleanup, import/export, in-app update

Cross-cutting: spotlight search, in-app notifications, keyboard shortcuts, bookmarks, EN/TH i18n, dark/light theme.

## How it talks to the workspace

Server spawns `task` commands as child processes (same commands the CLI runner uses). All scanning, validation, and command building reuse the patterns from `scripts/runner.ts` and `scripts/create-project.ts`.

## Boundaries

- Hub does **not** modify test code or framework configs
- Hub does **not** bypass `task` — every action maps to an existing recipe
- Hub does **not** require new tooling; only adds Node packages
