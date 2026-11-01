/**
 * Everworker Desktop Tools Module
 *
 * Registers desktop-specific tool categories with the core ToolCatalogRegistry.
 */

export { registerHoseaTools, updateBrowserService, invalidateHoseaTools } from './registration.js';

// Re-export core types for convenience
export { ToolCatalogRegistry } from 'oneringai';
export type { CatalogToolEntry, ToolCategoryDefinition } from 'oneringai';
