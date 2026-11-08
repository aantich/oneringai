import { InvalidConfigError } from '../../domain/errors/AIErrors.js';
import type { IPersistentInstructionsStorage } from '../../domain/interfaces/IPersistentInstructionsStorage.js';
import type { IUserInfoStorage } from '../../domain/interfaces/IUserInfoStorage.js';
import type { ICorrelationStorage } from '../../domain/interfaces/ICorrelationStorage.js';
import type { ITokenStorage } from '../../connectors/oauth/domain/ITokenStorage.js';
import { StorageRegistry } from '../../core/StorageRegistry.js';
import type { IRoutineDefinitionStorage } from '../../domain/interfaces/IRoutineDefinitionStorage.js';
const missing = (slot: string): never => { throw new InvalidConfigError(`Browser storage '${slot}' must be supplied through its existing storage option or StorageRegistry`); };
export const defaultInstructionsStorage = (_agentId: string): IPersistentInstructionsStorage => missing('persistentInstructions');
export const defaultUserInfoStorage = (): IUserInfoStorage => missing('userInfo');
export const defaultCorrelationStorage = (): ICorrelationStorage => missing('correlations');
export const defaultRoutineStorage = (): IRoutineDefinitionStorage => missing('routineDefinitions');
export const defaultTokenStorage = (): ITokenStorage => { throw new InvalidConfigError('OAuth/JWT credential acquisition requires a Node host'); };
export function preflightUserInfoStorage(storage?: IUserInfoStorage): void {
  if (!storage && !StorageRegistry.get('userInfo')) missing('userInfo');
}
