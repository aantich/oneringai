import { defineConfig } from 'tsup';

export default defineConfig([
  // Main bundle + shared + capabilities
  {
    entry: {
      index: 'src/index.ts',
      'shared/index': 'src/shared/index.ts',
      'capabilities/agents/index': 'src/capabilities/agents/index.ts',
      'capabilities/images/index': 'src/capabilities/images/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    treeshake: true,
    target: 'node18',
    platform: 'node',
    outDir: 'dist',
    external: ['cross-spawn'],
    // Bundle MCP SDK to avoid subpath import resolution issues in Meteor
    noExternal: [
      '@modelcontextprotocol/sdk',
    ],
  },
  // Lightweight types bundle — no Node.js / SDK dependencies
  {
    entry: {
      'types/index': 'src/types/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: false, // Don't clean dist — main build already did
    treeshake: true,
    target: 'es2020',
    platform: 'neutral',
    outDir: 'dist',
    // Externalize everything that isn't a pure domain/entity file
    external: [
      'jose',
      'eventemitter3',
      'fs',
      'path',
      'crypto',
      'node:fs',
      'node:path',
      'node:crypto',
      'node:fs/promises',
      'node:child_process',
      'openai',
      '@anthropic-ai/sdk',
      '@google/genai',
      '@modelcontextprotocol/sdk',
      'jsdom',
      'cheerio',
      'exceljs',
      'unpdf',
      'officeparser',
      'pngjs',
      'clipboardy',
      'glob',
      'cross-spawn',
      'simple-icons',
      'turndown',
      'zod',
      'dotenv',
      'readline-async',
    ],
  },
]);
