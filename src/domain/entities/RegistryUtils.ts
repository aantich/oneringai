/**
 * Generic utilities for model registries
 * Eliminates code duplication across Image, TTS, STT, and Video registries
 */

import type { Vendor as VendorType } from '../../core/Vendor.js';
import type { IBaseModelDescription } from '../types/SharedTypes.js';

/** Fail fast when an alias is ambiguous or shadowed by a canonical registry key. */
export function assertNoRegistryAliasCollisions<T extends { aliases?: readonly string[] }>(
  registry: Record<string, T>,
  registryName = 'model registry',
): void {
  const owners = new Map<string, string>();
  for (const [key, model] of Object.entries(registry)) {
    for (const alias of model.aliases ?? []) {
      const owner = owners.get(alias);
      if (alias in registry || owner) {
        const target = alias in registry ? `canonical key '${alias}'` : `model '${owner}'`;
        throw new Error(`${registryName} alias '${alias}' on '${key}' conflicts with ${target}`);
      }
      owners.set(alias, key);
    }
  }
}

/**
 * Creates standard helper functions for any model registry
 * This eliminates the need to write the same helper functions for each registry
 *
 * @example
 * ```typescript
 * const helpers = createRegistryHelpers(IMAGE_MODEL_REGISTRY);
 * export const getImageModelInfo = helpers.getInfo;
 * export const getImageModelsByVendor = helpers.getByVendor;
 * export const getActiveImageModels = helpers.getActive;
 * ```
 */
export function createRegistryHelpers<T extends IBaseModelDescription>(
  registry: Record<string, T>
) {
  return {
    /**
     * Get model information by name
     */
    getInfo: (modelName: string): T | undefined => {
      return registry[modelName]
        ?? Object.values(registry).find((model) => model.aliases?.includes(modelName));
    },

    /**
     * Get all active models for a specific vendor
     */
    getByVendor: (vendor: VendorType): T[] => {
      return Object.values(registry).filter(
        (model) => model.provider === vendor && model.isActive
      );
    },

    /**
     * Get all currently active models (across all vendors)
     */
    getActive: (): T[] => {
      return Object.values(registry).filter((model) => model.isActive);
    },

    /** Get models that are still callable but have a vendor deprecation notice. */
    getDeprecated: (): T[] => {
      return Object.values(registry).filter(
        (model) => model.isActive && model.lifecycle === 'deprecated'
      );
    },

    /**
     * Get all models (including inactive/deprecated)
     */
    getAll: (): T[] => {
      return Object.values(registry);
    },

    /**
     * Check if model exists in registry
     */
    has: (modelName: string): boolean => {
      return modelName in registry
        || Object.values(registry).some((model) => model.aliases?.includes(modelName));
    },
  };
}

/**
 * Creates feature-based filter for registries with capabilities
 * Used to find models that support specific features
 *
 * @example
 * ```typescript
 * const filter = createCapabilityFilter(IMAGE_MODEL_REGISTRY);
 * const modelsWithInpainting = filter.withFeature('inputModes').filter(
 *   m => m.capabilities.inputModes.inpainting
 * );
 * ```
 */
export function createCapabilityFilter<
  T extends IBaseModelDescription & { capabilities: Record<string, unknown> }
>(registry: Record<string, T>) {
  return {
    /**
     * Get models that have a specific capability feature
     * @param feature - The capability feature to filter by
     * @param value - Optional specific value to match (if undefined, just checks truthy)
     */
    withFeature: <K extends keyof T['capabilities']>(
      feature: K,
      value?: T['capabilities'][K]
    ): T[] => {
      return Object.values(registry).filter((model) => {
        if (!model.isActive) return false;

        const capValue = (model.capabilities as Record<string, unknown>)[feature as string];

        // If specific value provided, match exactly
        if (value !== undefined) {
          return capValue === value;
        }

        // Otherwise check if feature exists and is truthy
        return Array.isArray(capValue) ? capValue.length > 0 : Boolean(capValue);
      });
    },
  };
}
