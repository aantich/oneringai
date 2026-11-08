import { defineConfig } from 'tsup';
import { browserPlatformPlugin } from './scripts/browser-platform.mjs';
import { bundledDependenciesPlugin } from './scripts/release/bundle-provenance.mjs';

export default defineConfig([
  {
    entry: {
      'browser/index': 'src/browser/index.generated.ts',
      'browser/shared': 'src/browser/shared.generated.ts',
      'browser/types': 'src/browser/types.generated.ts',
      'browser/agents': 'src/browser/agents.generated.ts',
    },
    metafile: true,
    format: ['esm'],
    dts: { compilerOptions: { paths: { '#oneringai-media-bytes': ['./src/infrastructure/runtime/mediaTypes.browser.ts'] } } },
    splitting: true,
    sourcemap: true,
    clean: false,
    treeshake: true,
    target: 'es2022',
    platform: 'browser',
    outDir: 'dist',
    noExternal: [/.*/],
    esbuildPlugins: [browserPlatformPlugin(), bundledDependenciesPlugin('browser')],
  },
  // Main bundle + shared + capabilities
  {
    entry: {
      index: 'src/index.ts',
      'shared/index': 'src/shared/index.ts',
      'capabilities/agents/index': 'src/capabilities/agents/index.ts',
      'capabilities/images/index': 'src/capabilities/images/index.ts',
      'agent-runtime/index': 'src/agent-runtime/index.ts',
      'agent-runtime/codex': 'src/agent-runtime/codex.ts',
      'agent-runtime/claude': 'src/agent-runtime/claude.ts',
      'agent-runtime/openai-managed': 'src/agent-runtime/openai-managed.ts',
      'agent-runtime/claude-managed': 'src/agent-runtime/claude-managed.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    // Share runtime class/registry identity across root and optional driver entries.
    splitting: true,
    sourcemap: true,
    // Dist is cleaned once before all parallel configs start. Per-config clean
    // races can delete declarations emitted by another config.
    clean: false,
    treeshake: true,
    target: 'node22',
    platform: 'node',
    outDir: 'dist',
    // AJV must stay external: ajv-formats emits runtime require() expressions
    // that are invalid when folded into the ESM bundle.
    external: ['cross-spawn', '@openai/codex-sdk', '@anthropic-ai/claude-agent-sdk', 'ajv', 'ajv-formats'],
    // Bundle MCP SDK to avoid subpath import resolution issues in Meteor
    noExternal: [
      '@modelcontextprotocol/sdk',
    ],
    esbuildPlugins: [bundledDependenciesPlugin('node')],
  },
  // Browser-safe OpenAI Realtime WebRTC media and data-channel peer.
  {
    entry: {
      'realtime-browser/index': 'src/realtime-browser/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: false,
    treeshake: true,
    target: 'es2020',
    platform: 'browser',
    outDir: 'dist',
    esbuildPlugins: [bundledDependenciesPlugin('realtime')],
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
    esbuildPlugins: [bundledDependenciesPlugin('types')],
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
