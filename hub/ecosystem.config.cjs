const path = require('node:path');

const serverDir = path.resolve(__dirname, 'server');

/**
 * PM2 process tree for the AutoQA Hub.
 *
 * Single-process design: the Fastify server in `dist/index.js` mounts the
 * built client bundle as static assets, so no separate Vite preview
 * process is needed. Everything is served on HUB_PORT (5174) by default.
 *
 * Bind to 127.0.0.1 in production by default. Operators that need LAN
 * access set HUB_HOST=0.0.0.0 in `scripts/.env` and pm2 will inherit it.
 *
 * App name is consumed by:
 *   - hub/bin/hub-service.mjs — the cross-platform launcher that ALL entry
 *     points delegate to (the {windows,linux}-{start,stop}-hub.* scripts and the
 *     setup bootstrap). It calls `pm2 <cmd> ecosystem.config.cjs` and reads the
 *     app name from this file, so renaming here is enough — and it falls back to
 *     a daemonless `node dist/index.js` when PM2 is blocked.
 *   - hub/server/src/routes/system.ts + routes/git.ts (the in-app Update /
 *     pull-all buttons), which restart via `hub-service.mjs restart`.
 */
module.exports = {
  apps: [
    {
      name: 'auto-qa-hub-service',
      script: 'dist/index.js',
      cwd: serverDir,
      interpreter: 'node',
      windowsHide: true,
      watch: false,
      autorestart: true,
      max_restarts: 5,
      min_uptime: '5s',
      env: {
        NODE_ENV: 'production',
        HUB_HOST: process.env.HUB_HOST || '127.0.0.1',
        HUB_PORT: process.env.HUB_PORT || '5174',
        PATH: process.env.PATH || '',
      },
    },
  ],
};
