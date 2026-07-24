import { readFileSync } from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Mirror the `import.meta.env.VITE_APP_VERSION` define from vite.config.ts so any
// test that imports a module referencing it resolves the value instead of getting
// undefined (vitest does not read vite.config.ts).
const { version } = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(version),
  },
  resolve: {
    alias: {
      '~': path.resolve(__dirname, 'src'),
      '@hub/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  test: {
    // single-run (non-watch) is enforced via the `vitest run` script
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
