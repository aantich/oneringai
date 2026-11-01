import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    // UI dependencies are now declared by Hosea. Bundle dynamic chart imports
    // into browser-loadable chunks rather than leaving unresolved bare imports.
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
    },
  },
  // Pre-bundle optional peer deps from the local UI so Vite can
  // resolve their dynamic imports (import("mermaid") etc.) in dev mode.
  optimizeDeps: {
    include: ['mermaid', 'markmap-lib', 'markmap-view', 'react-vega', 'vega-lite'],
  },
});
