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
├── shared/    @hub/shared  → DTOs, types shared between server & client
├── server/    @hub/server  → Fastify 5 + WebSocket + project scanner + process runner
└── client/    @hub/client  → React 19 + Vite + Tailwind + xterm.js + TanStack Router/Query
```

## Features

- Dashboard — doctor status, project overview, recent runs
- Projects — list / create / clone projects per tool & type
- Run — tool/type/project/tags (multi-select, categorized) / headed-headless / extra args
- Live Output — xterm.js streaming via WebSocket, cancel button
- Reports — filter/sort/status table, open report, rerun
- Env Editor — edit project & scripts `.env` files
- Doctor — installation status (node, pnpm, uv, task, k6, docker, etc.)

## How it talks to the workspace

Server spawns `task` commands as child processes (same commands the CLI runner uses). All scanning, validation, and command building reuse the patterns from `scripts/runner.ts` and `scripts/create-project.ts`.

## Boundaries

- Hub does **not** modify test code or framework configs
- Hub does **not** bypass `task` — every action maps to an existing recipe
- Hub does **not** require new tooling; only adds Node packages
