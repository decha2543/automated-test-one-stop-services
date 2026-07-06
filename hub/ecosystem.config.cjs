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
 *   - hub/bin/{windows,linux}-{start,stop}-hub.* indirectly via this file
 *     (those scripts call `pm2 ... ecosystem.config.cjs`, so renaming here
 *     is enough — no follow-up edits needed in the shell scripts).
 *   - hub/server/src/routes/system.ts (the in-app Update button) which also
 *     restarts via the ecosystem file.
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
