import { defineConfig, devices } from '@playwright/test';

/**
 * Hub client smoke config.
 *
 * Boots the BUILT Hub server (`hub/server/dist/index.js`) on its own port and
 * drives the built SPA, so it catches client-runtime regressions that vitest
 * cannot see (lazy chunk loading, merged CSS).
 *
 * Every path below is relative to this file's directory — Playwright resolves
 * `testDir`, `outputDir` and `webServer.cwd` against the config location.
 */

/**
 * Dedicated smoke port. A developer's own Hub listens on 5174, so this suite
 * never shares a port with it. Override with `HUB_E2E_PORT` / `HUB_E2E_HOST`.
 */
const PORT = Number.parseInt(process.env.HUB_E2E_PORT ?? '5199', 10);
const HOST = process.env.HUB_E2E_HOST ?? '127.0.0.1';

export default defineConfig({
  testDir: '.',
  // Failure artefacts land in the workspace-level, git-ignored outputs/ tree.
  outputDir: '../../outputs/hub-e2e',
  fullyParallel: false,
  // One worker: the three specs share a single server process, and the suite is
  // short enough that parallel browsers only add startup cost.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  // The dashboard route waits on /api/doctor (environment probes) before it
  // paints, so first-paint assertions need more than the 5s default.
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://${HOST}:${PORT}`,
    headless: true,
    // Nothing recorded on a green run; artefacts appear only when something breaks.
    video: 'off',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // `pnpm run test:smoke` builds shared + server + client first.
    command: 'node dist/index.js',
    cwd: '../server',
    port: PORT,
    // Never adopt a Hub the developer is already running.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      HUB_HOST: HOST,
      HUB_PORT: String(PORT),
      // Ephemeral DB — the smoke run must not write hub/server/data/hub.db.
      HUB_DB_PATH: ':memory:',
      NODE_ENV: 'production',
    },
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
