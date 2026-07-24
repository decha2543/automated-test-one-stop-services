import { readFileSync } from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Single source of truth for the version shown in the UI (Settings → About):
// read it from this package.json at build time instead of hardcoding a string.
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
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id): string | undefined {
          if (
            id.includes('@mantine/core') ||
            id.includes('@mantine/hooks') ||
            id.includes('@mantine/modals') ||
            id.includes('@mantine/notifications') ||
            id.includes('@mantine/spotlight')
          ) {
            return 'mantine-core';
          }
          if (id.includes('@mantine/dates') || id.includes('dayjs')) {
            return 'mantine-dates';
          }
          if (id.includes('@mantine/charts') || id.includes('recharts')) {
            return 'mantine-charts';
          }
          if (id.includes('@mantine/schedule')) {
            return 'mantine-schedule';
          }
          if (id.includes('@xterm/xterm') || id.includes('@xterm/addon-fit')) {
            return 'xterm';
          }
          if (id.includes('@tanstack/react-query') || id.includes('@tanstack/react-router')) {
            return 'query';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5174',
      '/ws': {
        target: 'ws://127.0.0.1:5174',
        ws: true,
      },
    },
  },
});
