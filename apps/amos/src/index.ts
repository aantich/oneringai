#!/usr/bin/env node

/**
 * AMOS - Advanced Multimodal Orchestration System
 *
 * A terminal-based agentic application powered by OneRing AI Agents.
 *
 * Features:
 * - Runtime vendor/model switching
 * - Dynamic connector management
 * - Extensible tool system
 * - Conversational planning guidance and tool execution
 * - Session persistence
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AmosApp } from './app.js';

// Get the directory of the entry point
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Determine data directory
const dataDir = process.env.AMOS_DATA_DIR || join(__dirname, '..', 'data');

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

// Main entry point
async function main(): Promise<void> {
  const runtimeHostIndex = process.argv.indexOf('--runtime-host');
  const runtimeResumeIndex = process.argv.indexOf('--runtime-resume');
  if (runtimeResumeIndex >= 0 && runtimeHostIndex < 0) throw new Error('--runtime-resume requires --runtime-host');
  if (runtimeHostIndex >= 0) {
    const host = process.argv[runtimeHostIndex + 1]; if (!host || host.startsWith('--')) throw new Error('--runtime-host requires a trusted host module path');
    const { runtimeReference } = await import('./runtime/commands.js');
    const resume = runtimeResumeIndex >= 0 ? runtimeReference(process.argv[runtimeResumeIndex + 1] ?? '') : undefined;
    const { runRuntimeCli } = await import('./runtime/cli.js'); await runRuntimeCli(host, dataDir, resume); return;
  }
  const app = new AmosApp(dataDir);

  // Handle interrupt signals
  process.once('SIGINT', () => {
    console.log('\nReceived SIGINT, shutting down...');
    app.stop();
  });

  process.once('SIGTERM', () => {
    console.log('\nReceived SIGTERM, shutting down...');
    app.stop();
  });

  try {
    // Initialize
    await app.initialize();

    // Run main loop
    await app.run();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run
main();
