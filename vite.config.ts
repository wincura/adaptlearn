import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            if ('writeHead' in res && typeof res.writeHead === 'function' && !res.headersSent) {
              res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '1' });
              res.end(JSON.stringify({ error: 'Backend server initializing, please wait...' }));
            }
          });
        },
      },
      '/health': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            if ('writeHead' in res && typeof res.writeHead === 'function' && !res.headersSent) {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'initializing' }));
            }
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
