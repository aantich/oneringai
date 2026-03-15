/**
 * NextGen Context Plugins - Clean implementations
 */

export { WorkingMemoryPluginNextGen } from './WorkingMemoryPluginNextGen.js';
export type {
  WorkingMemoryPluginConfig,
  SerializedWorkingMemoryState,
  EvictionStrategy,
} from './WorkingMemoryPluginNextGen.js';

export { InContextMemoryPluginNextGen } from './InContextMemoryPluginNextGen.js';
export type {
  InContextMemoryConfig,
  InContextEntry,
  InContextPriority,
  SerializedInContextMemoryState,
} from './InContextMemoryPluginNextGen.js';

export { PersistentInstructionsPluginNextGen } from './PersistentInstructionsPluginNextGen.js';
export type {
  PersistentInstructionsConfig,
  SerializedPersistentInstructionsState,
  InstructionEntry,
} from './PersistentInstructionsPluginNextGen.js';

export { UserInfoPluginNextGen } from './UserInfoPluginNextGen.js';
export type {
  UserInfoPluginConfig,
  SerializedUserInfoState,
  UserInfoEntry,
} from './UserInfoPluginNextGen.js';

export { ToolCatalogPluginNextGen } from './ToolCatalogPluginNextGen.js';
export type {
  ToolCatalogPluginConfig,
} from './ToolCatalogPluginNextGen.js';

export { SharedWorkspacePluginNextGen } from './SharedWorkspacePluginNextGen.js';
export type {
  SharedWorkspaceConfig,
  SharedWorkspaceEntry,
  WorkspaceLogEntry,
  SerializedSharedWorkspaceState,
} from './SharedWorkspacePluginNextGen.js';
