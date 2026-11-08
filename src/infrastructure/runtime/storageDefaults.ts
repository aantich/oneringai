import { FilePersistentInstructionsStorage } from '../storage/FilePersistentInstructionsStorage.js';
import { FileUserInfoStorage } from '../storage/FileUserInfoStorage.js';
import { FileCorrelationStorage } from '../storage/FileCorrelationStorage.js';
import { MemoryStorage } from '../../connectors/oauth/infrastructure/storage/MemoryStorage.js';
import type { IUserInfoStorage } from '../../domain/interfaces/IUserInfoStorage.js';
import { FileRoutineDefinitionStorage } from '../storage/FileRoutineDefinitionStorage.js';
export const defaultInstructionsStorage = (agentId: string): FilePersistentInstructionsStorage => new FilePersistentInstructionsStorage({ agentId });
export const defaultUserInfoStorage = (): FileUserInfoStorage => new FileUserInfoStorage();
export const defaultCorrelationStorage = (): FileCorrelationStorage => new FileCorrelationStorage();
export const defaultTokenStorage = (): MemoryStorage => new MemoryStorage();
export const defaultRoutineStorage = (): FileRoutineDefinitionStorage => new FileRoutineDefinitionStorage();
export function preflightUserInfoStorage(_storage?: IUserInfoStorage): void { /* Preserve Node's lazy resolution. */ }
