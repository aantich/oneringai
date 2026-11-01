import type { RuntimeControl } from './RuntimeSessionStorage.js';
import type { RuntimeHostTools } from './RuntimeHostTools.js';
import type { IAsyncDisposable } from '../domain/interfaces/IDisposable.js';
import type { IConnectorRegistry } from '../domain/interfaces/IConnectorRegistry.js';
import type {
  AgentArtifact,
  AgentCapabilityRequirement,
  AgentExecutionPolicy,
  AgentInteractionResponse,
  AgentRunErrorInfo,
  AgentRunInput,
  AgentRunStatus,
  JsonObject,
  JsonValue,
  ResolvedAgentCapabilities,
  ResolvedAgentConfiguration,
  ResolvedWorkspace,
  RuntimeReasoningConfig,
  RuntimeAgentSpec,
  RuntimeResponseFormat,
  RuntimeUsage,
  TrustedRuntimeContext,
  RuntimeSessionSnapshot,
} from './types.js';

export interface DriverInspectionContext {
  spec: Readonly<RuntimeAgentSpec>;
  context?: TrustedRuntimeContext;
  workspace?: ResolvedWorkspace;
  policy?: AgentExecutionPolicy;
  requiredCapabilities: AgentCapabilityRequirement[];
  connectorRegistry: IConnectorRegistry;
  durability?: 'process' | 'durable';
}

export interface DriverDescriptor {
  capabilities: ResolvedAgentCapabilities;
  inspection?: {
    toolNamePrefix?: string;
    enforcement?: Record<string, 'native' | 'host' | 'unknown'>;
    notes?: string[];
  };
}

export interface DriverOpenSessionRequest {
  spec: Readonly<RuntimeAgentSpec>;
  sessionId?: string;
  control?: RuntimeControl;
  durability?: 'process' | 'durable';
  context: TrustedRuntimeContext;
  workspace?: ResolvedWorkspace;
  policy: AgentExecutionPolicy;
  requiredCapabilities: AgentCapabilityRequirement[];
  connectorRegistry: IConnectorRegistry;
  metadata?: JsonObject;
  hostTools?: RuntimeHostTools;
}

export interface DriverRunRequest {
  input: AgentRunInput;
  model?: string;
  reasoning?: RuntimeReasoningConfig;
  responseFormat?: RuntimeResponseFormat;
  signal: AbortSignal;
  metadata?: JsonObject;
}

export interface DriverEvent {
  type:
    | 'agent.message.delta'
    | 'agent.message.completed'
    | 'reasoning.delta'
    | 'reasoning.completed'
    | 'plan.updated'
    | 'agent.iteration.completed'
    | 'command.started'
    | 'command.output.delta'
    | 'command.completed'
    | 'file.change.started'
    | 'file.changed'
    | 'tool.started'
    | 'tool.progress'
    | 'tool.completed'
    | 'interaction.requested'
    | 'interaction.resolved'
    | 'usage.updated'
    | 'diagnostic';
  data: JsonObject;
  timestamp?: string;
}

export interface DriverRunResult {
  status: AgentRunStatus;
  outputText: string;
  outputParsed?: JsonValue;
  artifacts?: AgentArtifact[];
  usage?: RuntimeUsage;
  finishReason?: string;
  error?: AgentRunErrorInfo;
  configuration?: ResolvedAgentConfiguration;
  enforcement?: Record<string, 'native' | 'emulated'>;
  native?: JsonValue;
}

export interface DriverRun {
  readonly events: AsyncIterable<DriverEvent>;
  /** Settles only after native execution is terminal and can no longer mutate its workspace. */
  readonly result: Promise<DriverRunResult>;
  /** Requests cancellation; callers confirm termination through `result` and event completion. */
  cancel(reason?: string): Promise<void>;
  steer?(input: AgentRunInput): Promise<void>;
  respondToInteraction?(interactionId: string, response: AgentInteractionResponse): Promise<void>;
}

export interface DriverSession extends IAsyncDisposable {
  /** Managed native work survives observation loss; only explicit cancellation stops it. */
  readonly observationIndependent?: boolean;
  readonly nativeSessionId?: string;
  run(request: DriverRunRequest): Promise<DriverRun>;
  cancelActiveRun(reason?: string): Promise<void>;
  checkpoint?(): Promise<JsonObject>;
  inspectState?(): Promise<RuntimeSessionSnapshot>;
  detach?(): Promise<void>;
  uploadFile?(file: { name: string; data: Uint8Array; mediaType: string }): Promise<AgentArtifact>;
  downloadArtifact?(reference: string, limits: { maxBytes: number; mediaTypes: readonly string[] }): Promise<Response>;

}

export interface AgentDriver {
  readonly id: string;
  inspect(context: DriverInspectionContext): Promise<DriverDescriptor>;
  openSession(request: DriverOpenSessionRequest): Promise<DriverSession>;
  restoreSession?(request: DriverOpenSessionRequest & { checkpoint: JsonObject }): Promise<{
    session: DriverSession;
    activeRun?: DriverRun;
  }>;
  deleteSession?(request: DriverOpenSessionRequest & { checkpoint: JsonObject }): Promise<void>;
}
