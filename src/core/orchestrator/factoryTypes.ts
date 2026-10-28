import type { AgentConfig } from '../Agent.js';
import type { AgentContextNextGenConfig } from '../context-nextgen/types.js';
import type { AgentResponse } from '../../domain/entities/Response.js';
import type { EvidenceReference } from '../../domain/interfaces/IEvidenceStorage.js';
import type { ExecutionBinding } from '../execution/composition.js';
import type { ToolExecutionOutcome } from '../tool-execution/outcomes.js';

export type OrchestratedAgentConfig = Omit<AgentConfig, 'context' | 'toolManager' | 'name' | 'parentAgentId'> & {
  context?: AgentContextNextGenConfig;
  toolManager?: never;
  name?: never;
  parentAgentId?: never;
};
export type AgentConstructionRequest = {
  readonly name: string;
  readonly baseline: Readonly<OrchestratedAgentConfig>;
} & (
  | { readonly role: 'parent'; readonly type?: never }
  | { readonly role: 'worker'; readonly type: string }
);
export interface ChildObservation {
  readonly parentExecutionId: string;
  readonly childExecutionId: string;
  readonly childName: string;
  readonly state: 'settled' | 'timed_out' | 'cancelled' | 'uncertain';
  readonly reason?: string;
  readonly response?: Readonly<AgentResponse>;
  readonly accounting: 'shared' | 'independent';
  readonly modelTaskId?: string;
  readonly invocationIds: readonly string[];
  readonly references: readonly EvidenceReference[];
  /** Actual tool diagnostics, including late outcomes; business completion remains host-owned. */
  readonly toolOutcomes?: readonly ToolExecutionOutcome[];
  readonly late: boolean;
}
export interface OrchestratorFactoryOptions {
  configureAgent(request: AgentConstructionRequest): OrchestratedAgentConfig | Promise<OrchestratedAgentConfig>;
  descriptionExecution?: ExecutionBinding;
  onChildOutcome?(observation: ChildObservation): void;
}
