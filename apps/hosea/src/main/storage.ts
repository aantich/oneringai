import { join } from 'node:path';
import {
  FileAgentDefinitionStorage, FileContextStorage, FileCustomToolStorage,
  FilePersistentInstructionsStorage, FileUserInfoStorage, FileUserPermissionRulesStorage,
  FileRoutineDefinitionStorage, FileRoutineExecutionStorage, FileCorrelationStorage, FileMediaStorage,
} from 'oneringai';

/** Scope every app-owned persistent backend to the selected workspace. */
export function createHoseaStorage(dataDir: string, maxExecutionLogs: () => number = () => 100) {
  const users = join(dataDir, 'users');
  const agents = join(dataDir, 'agents');
  const routines = new FileRoutineDefinitionStorage({ baseDirectory: users });
  return {
    agentDefinitions: new FileAgentDefinitionStorage({ baseDirectory: join(dataDir, 'agent-definitions') }),
    sessions: (agentId: string) => new FileContextStorage({ agentId, baseDirectory: join(dataDir, 'sessions') }),
    persistentInstructions: (agentId: string) => new FilePersistentInstructionsStorage({ agentId, baseDirectory: agents }),
    userInfo: () => new FileUserInfoStorage({ baseDirectory: users }),
    customTools: () => new FileCustomToolStorage({ baseDirectory: users }),
    permissionRules: new FileUserPermissionRulesStorage({ baseDirectory: users }),
    routineDefinitions: () => routines,
    routineExecutions: () => new FileRoutineExecutionStorage({ baseDirectory: users, maxRecords: maxExecutionLogs() }),
    correlations: new FileCorrelationStorage({ baseDirectory: join(dataDir, 'correlations') }),
    media: new FileMediaStorage({ outputDir: join(dataDir, 'media') }),
  };
}
