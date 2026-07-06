# Dockerfile (TEMPLATE)
#
# Base image must match manifest.docker.baseImage.
# Only needed if the tool builds its own image (e.g. playwright, robot).
# Tools that run from an upstream image directly (e.g. k6 -> grafana/k6) skip this.

FROM node:22-slim

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install task runner
RUN sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin

# Install pnpm (node tools) — adjust for uv (python tools)
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /workspace

# Install this tool's dependencies in isolation (it is NOT a workspace member of
# any parent repo — see the workspace pnpm-workspace.yaml). Each tool ships its
# own lockfile and resolves into its own node_modules.
COPY tools/my-tool/package.json tools/my-tool/pnpm-lock.yaml tools/my-tool/
RUN pnpm -C tools/my-tool install --frozen-lockfile --ignore-workspace

# Copy tool source
COPY tools/my-tool/ tools/my-tool/
