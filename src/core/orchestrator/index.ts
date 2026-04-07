/**
 * Agent Orchestrator v2 - Multi-agent coordination with 3-tier routing
 *
 * Enables an orchestrator Agent to manage a team of worker agents
 * with shared workspace, async execution, interactive delegation, and monitoring.
 */

export { createOrchestrator } from './createOrchestrator.js';
export type { OrchestratorConfig, AgentTypeConfig, DelegationDefaults } from './createOrchestrator.js';
export { buildOrchestrationTools, buildWorkspaceDelta, createDelegationState } from './tools.js';
export type { OrchestrationToolsContext, DelegationState, DelegationReclaimConfig } from './tools.js';
