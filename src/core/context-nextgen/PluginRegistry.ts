/**
 * PluginRegistry — Global registry for external plugin factories.
 *
 * Allows external packages to register plugin factories that auto-initialize
 * when the corresponding feature flag is enabled in ContextFeatures.
 *
 * Built-in plugins (workingMemory, inContextMemory, etc.) are NOT registered
 * here — they remain hardcoded in AgentContextNextGen.initializePlugins().
 * This registry is exclusively for EXTERNAL plugins.
 *
 * Follows the StrategyRegistry pattern: static class, private Map, lazy init.
 *
 * @example
 * ```typescript
 * // In an external package (e.g., @everworker/react-ui/plugins.ts)
 * import { PluginRegistry } from 'oneringai';
 * import { DynamicUIPlugin } from './DynamicUIPlugin';
 *
 * PluginRegistry.register('dynamic_ui', (config) => new DynamicUIPlugin(config), {
 *   description: 'Rich side-panel content via InContextMemory showInUI',
 *   dependencies: ['inContextMemory'],
 * });
 *
 * // In app code
 * import '@everworker/react-ui/plugins'; // side-effect registers factory
 *
 * const agent = Agent.create({
 *   connector: 'openai', model: 'gpt-4',
 *   context: { features: { dynamicUI: true } }, // auto-initializes!
 * });
 * ```
 */

import type { IContextPluginNextGen } from './types.js';

// ============================================================================
// Types
// ============================================================================

/** Context passed to plugin factories during auto-initialization */
export interface PluginFactoryContext {
  agentId: string;
  userId?: string;
  features: Record<string, boolean | undefined>;
}

/** Plugin factory function — creates a plugin instance from optional config */
export type PluginFactory = (
  config?: Record<string, unknown>,
  context?: PluginFactoryContext
) => IContextPluginNextGen;

/** Options for registering a plugin */
export interface PluginRegisterOptions {
  /**
   * Feature flag key in camelCase (e.g., 'dynamicUI').
   * If omitted, derived from pluginName via snake_case → camelCase conversion.
   */
  featureKey?: string;
  /** Human-readable description */
  description?: string;
  /** Feature keys (camelCase) that must also be enabled for this plugin to work */
  dependencies?: string[];
}

/** Registry entry for an external plugin */
export interface PluginRegistryEntry {
  /** Feature flag key in ContextFeatures (camelCase, e.g., 'dynamicUI') */
  featureKey: string;
  /** Plugin name (snake_case, e.g., 'dynamic_ui') — must match plugin.name */
  pluginName: string;
  /** Factory to create plugin instances */
  factory: PluginFactory;
  /** Human-readable description */
  description?: string;
  /** Feature keys that must be enabled for this plugin to work */
  dependencies?: string[];
}

/** Serializable plugin info (no factory reference) */
export interface PluginRegistryInfo {
  featureKey: string;
  pluginName: string;
  description?: string;
  dependencies?: string[];
}

// ============================================================================
// Built-in Protection
// ============================================================================

/** Feature keys reserved for built-in plugins — cannot be overridden */
const BUILT_IN_FEATURE_KEYS = new Set([
  'workingMemory',
  'inContextMemory',
  'persistentInstructions',
  'userInfo',
  'toolCatalog',
  'sharedWorkspace',
]);

// ============================================================================
// Utilities
// ============================================================================

/** Convert snake_case to camelCase: 'dynamic_ui' → 'dynamicUI' */
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

// ============================================================================
// Registry
// ============================================================================

export class PluginRegistry {
  private static registry: Map<string, PluginRegistryEntry> = new Map();

  /**
   * Register an external plugin factory.
   *
   * @param pluginName - Plugin name in snake_case (must match plugin.name)
   * @param factory - Factory function to create plugin instances
   * @param options - Registration options (featureKey, description, dependencies)
   *
   * @throws If featureKey collides with a built-in plugin
   * @throws If featureKey is already registered
   */
  static register(
    pluginName: string,
    factory: PluginFactory,
    options?: PluginRegisterOptions,
  ): void {
    const featureKey = options?.featureKey ?? snakeToCamel(pluginName);

    if (BUILT_IN_FEATURE_KEYS.has(featureKey)) {
      throw new Error(
        `Cannot register '${pluginName}' — feature key '${featureKey}' is reserved for a built-in plugin. ` +
        `Built-in keys: ${Array.from(BUILT_IN_FEATURE_KEYS).join(', ')}`,
      );
    }

    if (this.registry.has(featureKey)) {
      throw new Error(
        `Plugin with feature key '${featureKey}' is already registered. ` +
        `Registered: ${Array.from(this.registry.keys()).join(', ')}`,
      );
    }

    this.registry.set(featureKey, {
      featureKey,
      pluginName,
      factory,
      description: options?.description,
      dependencies: options?.dependencies,
    });
  }

  /** Check if a feature key has a registered factory */
  static has(featureKey: string): boolean {
    return this.registry.has(featureKey);
  }

  /** Get a registry entry by feature key */
  static get(featureKey: string): PluginRegistryEntry | undefined {
    return this.registry.get(featureKey);
  }

  /** List all registered feature keys */
  static list(): string[] {
    return Array.from(this.registry.keys());
  }

  /** Get serializable info for all registered plugins (no factory references) */
  static getInfo(): PluginRegistryInfo[] {
    return Array.from(this.registry.values()).map(
      ({ featureKey, pluginName, description, dependencies }) => ({
        featureKey, pluginName, description, dependencies,
      }),
    );
  }

  /** Remove a registered plugin by feature key */
  static remove(featureKey: string): boolean {
    return this.registry.delete(featureKey);
  }

  /** Get all entries as ReadonlyMap (internal use by AgentContextNextGen) */
  static getAll(): ReadonlyMap<string, PluginRegistryEntry> {
    return this.registry;
  }

  /** Reset registry — for testing only */
  static _reset(): void {
    this.registry.clear();
  }
}
