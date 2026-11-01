import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'main/index': 'src/main/index.ts',
    'preload/index': 'src/preload/index.ts',
  },
  format: ['cjs'],
  outDir: 'dist',
  outExtension: () => ({ js: '.cjs' }),
  // Don't use clean: true - it wipes dist/renderer/ built by vite
  clean: false,
  splitting: false,
  sourcemap: true,
  external: ['electron'],
  // Bundle oneringai into the output
  noExternal: ['oneringai'],
  platform: 'node',
  target: 'node18',
  // Handle dynamic requires
  shims: true,
});
