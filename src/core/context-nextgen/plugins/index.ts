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

export {
  MemoryPluginNextGen,
  USER_IDENTIFIER_KIND,
  AGENT_IDENTIFIER_KIND,
  GROUP_IDENTIFIER_KIND,
} from './MemoryPluginNextGen.js';
export type {
  MemoryPluginConfig,
  MemoryPluginInjectionConfig,
} from './MemoryPluginNextGen.js';

export { MemoryWritePluginNextGen } from './MemoryWritePluginNextGen.js';
export type { MemoryWritePluginConfig } from './MemoryWritePluginNextGen.js';

export {
  SessionIngestorPluginNextGen,
  buildSessionExtractionPrompt,
  renderMessage as renderSessionMessage,
} from './SessionIngestorPluginNextGen.js';
export type {
  SessionIngestorPluginConfig,
  SessionIngestorDiligence,
} from './SessionIngestorPluginNextGen.js';
