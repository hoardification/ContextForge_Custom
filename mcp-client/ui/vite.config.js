import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Reachable from other machines on the LAN, not just localhost.
    host: true,
    port: 5174,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.VITE_AGENT_TARGET || 'http://localhost:4200',
        changeOrigin: true,
        // Local inference is slow; don't time out mid-generation.
        timeout: 300_000,
        proxyTimeout: 300_000,
      },
    },
  },
  preview: {
    host: true,
    port: 4174,
    allowedHosts: true,
  },
  build: { outDir: 'dist', sourcemap: false },
});
