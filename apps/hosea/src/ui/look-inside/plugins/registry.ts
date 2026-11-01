/**
 * Plugin Renderer Registry — Maps plugin names to custom renderer components.
 *
 * Built-in renderers are registered by default. Apps can register
 * additional renderers for custom plugins.
 */

import type { PluginRenderer } from '../types.js';
import { WorkingMemoryRenderer } from './WorkingMemoryRenderer.js';
import { InContextMemoryRenderer } from './InContextMemoryRenderer.js';
import { PersistentInstructionsRenderer } from './PersistentInstructionsRenderer.js';
import { UserInfoRenderer } from './UserInfoRenderer.js';

const renderers = new Map<string, PluginRenderer>();

// Register built-in renderers
renderers.set('working_memory', WorkingMemoryRenderer);
renderers.set('in_context_memory', InContextMemoryRenderer);
renderers.set('persistent_instructions', PersistentInstructionsRenderer);
renderers.set('user_info', UserInfoRenderer);

/**
 * Register a custom plugin renderer.
 */
export function registerPluginRenderer(name: string, renderer: PluginRenderer): void {
  renderers.set(name, renderer);
}

/**
 * Get the renderer for a plugin (or null for fallback to GenericPluginSection).
 */
export function getPluginRenderer(name: string): PluginRenderer | null {
  return renderers.get(name) ?? null;
}

/**
 * Get all registered renderer names.
 */
export function getRegisteredPluginNames(): string[] {
  return Array.from(renderers.keys());
}
