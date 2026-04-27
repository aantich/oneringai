/**
 * IRoutineDefinitionStorage - Storage interface for routine definitions.
 *
 * Accepts StorageUserContextInput (string | undefined | StorageUserContext) for
 * backward compatibility. Implementations use resolveStorageUserContext() to
 * normalize the input.
 *
 * When bypassOwnerScope is true, operations match by ID only — not scoped
 * by ownerId. This enables admin operations on system/shared routines.
 */

import type { RoutineDefinition, RoutineSummary } from '../entities/Routine.js';
import type { StorageUserContextInput } from './StorageContext.js';

export interface IRoutineDefinitionStorage {
  save(context: StorageUserContextInput, definition: RoutineDefinition): Promise<void>;
  load(context: StorageUserContextInput, id: string): Promise<RoutineDefinition | null>;
  delete(context: StorageUserContextInput, id: string): Promise<void>;
  exists(context: StorageUserContextInput, id: string): Promise<boolean>;
  /**
   * List routine summaries (slim projection). Use load(id) to fetch the full
   * definition for any returned entry.
   */
  list(context: StorageUserContextInput, options?: {
    tags?: string[];
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<RoutineSummary[]>;
  getPath(context: StorageUserContextInput): string;
}
