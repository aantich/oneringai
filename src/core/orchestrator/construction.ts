import type { AgentContextNextGenConfig } from '../context-nextgen/types.js';
import type { AgentContextNextGen } from '../context-nextgen/AgentContextNextGen.js';
import type { SharedWorkspacePluginNextGen } from '../context-nextgen/plugins/SharedWorkspacePluginNextGen.js';
import type { IConnectorRegistry } from '../../domain/interfaces/IConnectorRegistry.js';
import { InvalidConfigError } from '../../domain/errors/AIErrors.js';

const CONSTRUCTION = Symbol.for('@everworker/oneringai/orchestrator-construction/v1');
const constructing = new WeakSet<object>();
export interface OrchestratorConstruction {
  readonly version: 1;
  readonly workspace: SharedWorkspacePluginNextGen;
  readonly worker: boolean;
  readonly deferWorkspaceDestroy?: boolean;
  readonly registry?: IConnectorRegistry;
}
/** Private configuration companion copied through ordinary context option spreads. */
export function markOrchestratorConstruction(config: AgentContextNextGenConfig, spec: OrchestratorConstruction): void {
  Object.defineProperty(config, CONSTRUCTION, { value: Object.freeze({ ...spec }), enumerable: true });
}
export function orchestratorConstruction(config: unknown): OrchestratorConstruction | undefined {
  if (!config || typeof config !== 'object') return undefined;
  try {
    const value = Object.getOwnPropertyDescriptor(config, CONSTRUCTION)?.value as OrchestratorConstruction | undefined;
    return value?.version === 1 ? value : undefined;
  } catch { return undefined; }
}
export function initializeOrchestratorContext(context: AgentContextNextGen, spec: OrchestratorConstruction): void {
  constructing.add(context.tools);
  context.registerPlugin(spec.workspace, { skipDestroyOnContextDestroy: spec.worker || spec.deferWorkspaceDestroy });
}
export function isOrchestratorConstruction(manager: object): boolean { return constructing.has(manager); }
export function finishOrchestratorConstruction(manager: object): void { constructing.delete(manager); }
export function assertConstructionTool(manager: object, name: string, exists: boolean): void {
  if (exists && constructing.has(manager)) throw new InvalidConfigError(`Orchestrator construction tool collision: ${name}`);
}
