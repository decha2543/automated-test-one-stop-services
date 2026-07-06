import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@hub/shared', replacement: path.resolve(__dirname, '../shared/src/index.ts') },
      { find: /^@server\//, replacement: `${path.resolve(__dirname, 'src')}/` },
    ],
  },
  test: {
    // single-run (non-watch) is enforced via the `vitest run` script
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts'],
  },
});
