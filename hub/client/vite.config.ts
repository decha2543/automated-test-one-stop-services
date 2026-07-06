import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
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
