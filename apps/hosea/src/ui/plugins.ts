/**
 * Standalone entry point for non-React exports (plugins, utilities).
 *
 * Import via: import { DynamicUIPlugin } from '../plugins.js';
 *
 * This avoids pulling in React components — safe for Node.js / Electron main process.
 */

export * from './plugins/index.js';
