import { defineConfig } from 'vitest/config';

// Minimal vitest config scoped to the install-core library tests
// (install-and-provisioning-overhaul, design §Testing Strategy). Mirrors the
// `scripts/manifests/vitest.config.ts` convention (node env, globals on,
// single-run). Source files use `.js`-extension ESM imports that resolve to
// their `.ts` sources — vite's resolver handles this out of the box, including
// the cross-module `../manifests/setup-planner.js` planner reuse.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      all: true,
      include: ['validation.ts', 'invocation.ts', 'pipeline.ts', 'provision.ts'],
      reporter: ['text', 'text-summary'],
    },
  },
});
