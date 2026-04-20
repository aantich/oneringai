#!/usr/bin/env node
/**
 * memlab entry point.
 */

import 'dotenv/config';
import './bootstrap.js';
import { App } from './app.js';

async function main(): Promise<void> {
  const app = new App();
  await app.run();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
