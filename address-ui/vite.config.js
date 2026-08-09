import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev server. In production this app is static files behind nginx, which does
// the /api proxying instead (see nginx.conf).
export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on every interface so the dev server is reachable from other
    // machines on the LAN, not just localhost.
    host: true,
    port: 5173,
    // Vite blocks requests whose Host header it doesn't recognise; allow the
    // LAN IP or hostname a colleague would type.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
  },
  build: { outDir: 'dist', sourcemap: false },
});
