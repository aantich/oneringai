/**
 * Shared helper to resolve IRoutineDefinitionStorage for routine tools.
 *
 * Resolution order:
 * 1. Explicit storage passed to the factory function (backward compat)
 * 2. StorageRegistry factory called with StorageContext (multi-tenant)
 * 3. Default FileRoutineDefinitionStorage
 */

import type { IRoutineDefinitionStorage } from '../../domain/interfaces/IRoutineDefinitionStorage.js';
import type { ToolContext } from '../../domain/interfaces/IToolContext.js';
import { defaultRoutineStorage } from '../../infrastructure/runtime/storageDefaults.js';
import { StorageRegistry } from '../../core/StorageRegistry.js';
import type { StorageContext } from '../../core/StorageRegistry.js';

/**
 * Build a StorageContext from ToolContext (extracts userId).
 */
function buildStorageContext(toolContext?: ToolContext): StorageContext | undefined {
  const global = StorageRegistry.getContext();
  if (global) return global;
  if (toolContext?.userId) return { userId: toolContext.userId };
  return undefined;
}

/**
 * Resolve routine definition storage.
 *
 * @param explicit - Storage instance passed to the factory (highest priority)
 * @param toolContext - ToolContext from execution (provides userId for multi-tenant)
 */
export function resolveRoutineDefinitionStorage(
  explicit: IRoutineDefinitionStorage | undefined,
  toolContext?: ToolContext,
): IRoutineDefinitionStorage {
  // 1. Explicit storage (backward compat)
  if (explicit) return explicit;

  // 2. Registry factory
  const factory = StorageRegistry.get('routineDefinitions');
  if (factory) {
    return factory(buildStorageContext(toolContext));
  }

  // 3. Default
  return defaultRoutineStorage();
}
