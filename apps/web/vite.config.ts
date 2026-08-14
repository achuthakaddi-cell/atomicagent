import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Vite configuration.
 *
 * envDir points at the repository root so the frontend reads the SAME .env as
 * the four backend services. One source of truth for ports and URLs means the
 * frontend cannot drift out of sync with the orchestrator it talks to.
 *
 * import.meta.dirname is used rather than __dirname, which Vite 8 flags as
 * unsupported under its native config loader.
 */
const here = import.meta.dirname;
const repoRoot = path.resolve(here, '../..');

export default defineConfig({
  plugins: [react()],
  envDir: repoRoot,
  envPrefix: 'VITE_',
  define: {
    // algosdk expects a Node-style global. Without this it throws
    // "global is not defined" in the browser.
    global: 'globalThis',
  },
  resolve: {
    alias: {
      '@': path.resolve(here, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  optimizeDeps: {
    // Large CJS-flavoured dependencies. Pre-bundling avoids a slow first load
    // and intermittent dev-server resolution errors.
    include: ['algosdk', '@perawallet/connect'],
  },
});