/**
 * Look Inside components — Shared UI for inspecting agent context.
 */

// Main panel
export { LookInsidePanel } from './LookInsidePanel.js';

// View context content (no modal wrapper)
export { ViewContextContent } from './ViewContextContent.js';

// Collapsible section (reusable)
export { CollapsibleSection } from './CollapsibleSection.js';

// Individual sections (for composable use)
export { ContextWindowSection } from './sections/ContextWindowSection.js';
export { TokenBreakdownSection } from './sections/TokenBreakdownSection.js';
export { SystemPromptSection } from './sections/SystemPromptSection.js';
export { ToolsSection } from './sections/ToolsSection.js';
export { GenericPluginSection } from './sections/GenericPluginSection.js';

// Plugin renderers
export { WorkingMemoryRenderer } from './plugins/WorkingMemoryRenderer.js';
export { InContextMemoryRenderer } from './plugins/InContextMemoryRenderer.js';
export { PersistentInstructionsRenderer } from './plugins/PersistentInstructionsRenderer.js';
export { UserInfoRenderer } from './plugins/UserInfoRenderer.js';

// Plugin renderer registry
export {
  registerPluginRenderer,
  getPluginRenderer,
  getRegisteredPluginNames,
} from './plugins/registry.js';

// Types
export type {
  LookInsidePanelProps,
  ViewContextContentProps,
  CollapsibleSectionProps,
  PluginRenderer,
  PluginRendererProps,
  IContextSnapshot,
  IPluginSnapshot,
  IToolSnapshot,
  IViewContextData,
  IViewContextComponent,
} from './types.js';

// Utilities
export {
  formatBytes,
  formatNumber,
  getUtilizationColor,
  getUtilizationLabel,
  truncateText,
  formatPluginName,
  formatTimestamp,
} from './utils.js';
