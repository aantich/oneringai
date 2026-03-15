/**
 * Agent Orchestrator - Multi-agent coordination
 *
 * Enables an orchestrator Agent to manage a team of worker agents
 * with shared workspace, async turns, and message injection.
 */

export { createOrchestrator } from './createOrchestrator.js';
export type { OrchestratorConfig, AgentTypeConfig } from './createOrchestrator.js';
export { buildOrchestrationTools, buildWorkspaceDelta } from './tools.js';
export type { OrchestrationToolsContext } from './tools.js';
