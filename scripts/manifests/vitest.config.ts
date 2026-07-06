import { defineConfig } from 'vitest/config';

// Minimal vitest config scoped to the manifest module foundation tests
// (design §8.1). Mirrors the hub/server convention (node env, globals on,
// single-run). Source files use `.js`-extension ESM imports that resolve to
// their `.ts` sources — vite's resolver handles this out of the box.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Sequential test files — these specs do 100s of real temp-dir mkdir/write/
    // rename/rm per property; parallel files contend for Windows file locks and
    // flake (EPERM-on-rename / hook timeout). Sequential is deterministic and
    // still fast (~15s for the whole module).
    fileParallelism: false,
    // These property suites do 100s of real temp-dir mkdir/write/rename/rm ops
    // per test. On Windows under Defender/indexer those legitimately exceed the
    // 5s test / 10s hook defaults (the work is bounded but slow IO, not a hang).
    // A generous bound removes the environmental timeout flake without masking
    // any logic fault — a true hang still trips the limit.
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ['__tests__/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      all: true,
      include: ['validate.ts', 'discover.ts', 'fs-helpers.ts'],
      reporter: ['text', 'text-summary'],
      thresholds: {
        lines: 90,
      },
    },
  },
});
