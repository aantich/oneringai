/**
 * Plugins — Non-React plugins for OneRingAI agent context.
 *
 * Importing this module auto-registers plugin factories with PluginRegistry.
 * Import via 'Hosea local UI plugins' to avoid pulling in React dependencies.
 *
 * @example
 * ```typescript
 * import '../plugins.js'; // side-effect: registers DynamicUI factory
 *
 * const agent = Agent.create({
 *   context: { features: { dynamicUI: true } }, // auto-initializes!
 * });
 * ```
 */

import { PluginRegistry } from 'oneringai';
import { DynamicUIPlugin } from './DynamicUIPlugin.js';

// Auto-register DynamicUI plugin factory when this module is imported.
// Plugin config is read from agentContext.plugins.dynamicUI (forwarded by
// AgentContextNextGen). Recognized keys:
//   - interactiveUI: boolean (default false) — opt in to ```ui form/button instructions
PluginRegistry.register('dynamic_ui', (config) => new DynamicUIPlugin(config), {
  featureKey: 'dynamicUI',
  description: 'Rich side-panel content via InContextMemory showInUI',
  dependencies: ['inContextMemory'],
});

export { DynamicUIPlugin };
export type { DynamicUIPluginConfig } from './DynamicUIPlugin.js';
