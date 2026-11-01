import type { IAsyncDisposable } from '../domain/interfaces/IDisposable.js';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type AgentCapabilityId =
  | 'session.continue'
  | 'session.restore'
  | 'run.cancel'
  | 'run.structured_output'
  | 'run.model_override'
  | 'run.reasoning_override'
  | 'run.interaction'
  | 'run.approval'
  | 'run.user_input'
  | 'run.steer'
  | 'input.image'
  | 'event.live'
  | 'event.message'
  | 'event.reasoning'
  | 'event.plan'
  | 'event.command'
  | 'event.command_output'
  | 'event.file_change'
  | 'event.tool'
  | 'event.tool_progress'
  | 'isolation.workspace'
  | 'isolation.tenant'
  | (string & {});

export type CapabilitySupport = 'native' | 'emulated' | 'unsupported';

export interface AgentCapability {
  id: AgentCapabilityId;
  support: CapabilitySupport;
  constraints?: JsonObject;
  reason?: string;
}

export interface AgentCapabilityRequirement {
  id: AgentCapabilityId;
  minimum?: Exclude<CapabilitySupport, 'unsupported'>;
}

export interface ResolvedAgentCapabilities {
  driverId: string;
  capabilities: Record<string, AgentCapability>;
  configuration?: ResolvedAgentConfiguration;
  /** Present for common definitions; legacy capability descriptors remain unchanged. */
  inspection?: RuntimeInspectionDetails;
}

export type RuntimeReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultra';

export interface RuntimeReasoningConfig {
  /** Defaults to true when a reasoning object is supplied. */
  enabled?: boolean;
  effort?: RuntimeReasoningEffort;
  budgetTokens?: number;
}

export interface ResolvedAgentConfiguration {
  model?: string;
  reasoning?: RuntimeReasoningConfig;
}

export interface RuntimeAgentSpec {
  id: string;
  name?: string;
  /** Opt-in logical definition; legacy specs are unchanged. */
  definition?: RuntimeAgentDefinition;
  environment?: RuntimeEnvironmentRequest;
  driver: string;
  connector?: string;
  model?: string;
  reasoning?: RuntimeReasoningConfig;
  instructions?: string;
  driverConfig?: JsonObject;
  requiredCapabilities?: AgentCapabilityRequirement[];
  metadata?: JsonObject;
}

export interface TrustedRuntimeContext {
  tenantId?: string;
  userId?: string;
  groupId?: string;
  metadata?: JsonObject;
}

export type WorkspaceRequest =
  | { type: 'local-directory'; path: string }
  | { type: 'managed'; reference: string };

export interface ResolvedWorkspace {
  type: 'local-directory';
  root: string;
  identity: string;
}

export interface AgentExecutionPolicy {
  filesystem: 'denied' | 'read-only' | 'workspace-write';
  commands: 'denied' | 'sandboxed';
  sandboxNetwork: 'denied' | 'allowed';
  providerWebSearch: 'denied' | 'allowed';
  approvals: 'deny' | 'interactive';
  limits?: {
    wallTimeMs?: number;
    eventBufferBytes?: number;
    outputBytes?: number;
    artifactBytes?: number;
  };
}

export interface AgentInspectionRequest {
  context?: TrustedRuntimeContext;
  workspace?: WorkspaceRequest;
  policy?: AgentExecutionPolicy;
  requiredCapabilities?: AgentCapabilityRequirement[];
}

export interface OpenAgentSessionOptions {
  context: TrustedRuntimeContext;
  workspace?: WorkspaceRequest;
  policy: AgentExecutionPolicy;
  /** Live observation is independent from approvals and intervention. */
  observation?: AgentObservationOptions;
  /** Observe-only is the portable default; steerable sessions require run.steer. */
  controlMode?: AgentControlMode;
  requiredCapabilities?: AgentCapabilityRequirement[];
  metadata?: JsonObject;
}

export type AgentControlMode = 'observe-only' | 'steerable';

export interface AgentObservationOptions {
  /** Drivers are always pumped internally; this controls which events callers receive and retain. */
  mode?: 'live' | 'final-only';
  /** `reasoning` includes every reasoning event the vendor makes available. */
  detail?: 'status' | 'activity' | 'reasoning';
}

export type AgentRunInput =
  | string
  | {
      parts: AgentInputPart[];
      metadata?: JsonObject;
    };

export type AgentInputPart =
  | { type: 'text'; text: string }
  /** Local image input; requires the driver to advertise input.image. */
  | { type: 'workspace-file'; path: string; mediaType?: string };

export type RuntimeResponseFormat =
  | { type: 'text' }
  | {
      type: 'json_schema';
      name?: string;
      schema: JsonObject;
      strict?: boolean;
    };

export interface AgentRunOptions {
  signal?: AbortSignal;
  /** Per-run override. The driver must advertise run.model_override. */
  model?: string;
  /** Per-run override. The driver must advertise run.reasoning_override. */
  reasoning?: RuntimeReasoningConfig;
  /** JSON Schema output requires the driver to advertise run.structured_output. */
  responseFormat?: RuntimeResponseFormat;
  metadata?: JsonObject;
}

export type AgentSessionState =
  | 'opening'
  | 'ready'
  | 'running'
  | 'failed'
  | 'destroying'
  | 'destroyed';

export type AgentRunStatus = 'completed' | 'failed' | 'cancelled' | 'incomplete';

export type AgentRunEventType =
  | 'run.started'
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
  | 'diagnostic'
  | 'run.finished';

export interface AgentRunEvent {
  readonly runId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly type: AgentRunEventType;
  readonly data: Readonly<JsonObject>;
}

export interface AgentEventSubscriptionOptions {
  /** Replay only events after this sequence. Throws when that history was evicted. */
  afterSequence?: number;
}

export interface AgentInteractionResponse {
  decision?: 'accept' | 'accept-for-session' | 'decline' | 'cancel';
  value?: JsonValue;
}

export interface RuntimeUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  native?: JsonObject;
}

export interface AgentRunErrorInfo {
  code: string;
  message: string;
  retryable?: boolean;
  details?: JsonObject;
}

export type AgentArtifact =
  | {
      type: 'workspace-change';
      path: string;
      change: 'created' | 'modified' | 'deleted';
      patch?: string;
    }
  | {
      type: 'reference';
      name: string;
      mediaType?: string;
      reference: string;
    };

export interface AgentRunResult {
  runId: string;
  sessionId: string;
  status: AgentRunStatus;
  outputText: string;
  outputParsed?: JsonValue;
  artifacts: AgentArtifact[];
  usage?: RuntimeUsage;
  finishReason?: string;
  error?: AgentRunErrorInfo;
  configuration?: ResolvedAgentConfiguration;
  enforcement?: Record<string, 'native' | 'emulated'>;
  native?: {
    driver: string;
    sanitized: JsonValue;
  };
}

export interface AgentRun {
  readonly id: string;
  readonly sessionId: string;
  readonly result: Promise<AgentRunResult>;

  events(options?: AgentEventSubscriptionOptions): AsyncIterable<AgentRunEvent>;
  cancel(reason?: string): Promise<void>;
  steer(input: AgentRunInput): Promise<void>;
  respondToInteraction(interactionId: string, response: AgentInteractionResponse): Promise<void>;
}

export interface AgentSession extends IAsyncDisposable {
  readonly id: string;
  readonly agentId: string;
  readonly capabilities: ResolvedAgentCapabilities;
  readonly state: AgentSessionState;

  run(input: AgentRunInput, options?: AgentRunOptions): Promise<AgentRun>;
  cancelActiveRun(reason?: string): Promise<void>;
}

export interface RuntimeAgent {
  readonly spec: Readonly<RuntimeAgentSpec>;

  inspect(request?: AgentInspectionRequest): Promise<ResolvedAgentCapabilities>;
  openSession(options: OpenAgentSessionOptions): Promise<AgentSession>;
}

/** A harness-independent task definition. Tools are exact host-resolved names. */
export interface RuntimeAgentDefinition {
  id: string;
  revision?: string;
  name?: string;
  instructions: string;
  tools?: readonly string[];
  requiredCapabilities?: readonly AgentCapabilityRequirement[];
  metadata?: JsonObject;
}
export interface RuntimeExecutionBinding {
  driver: string;
  connector: string;
  model: string;
  reasoning?: RuntimeReasoningConfig;
  driverConfig?: JsonObject;
}
export type RuntimeEnvironmentRequest =
  | { type: 'none' }
  | { type: 'local-directory'; path: string }
  | { type: 'provider-managed'; reference?: string };
export interface RuntimeSessionOptions extends OpenAgentSessionOptions {
  execution: RuntimeExecutionBinding;
  environment?: RuntimeEnvironmentRequest;
}
export interface RuntimeInspectionDetails {
  executionDigest: string;
  tools: { name: string; schemaDigest: string; transportName?: string }[];
  environment: RuntimeEnvironmentRequest | { type: 'unspecified' };
  enforcement: Record<string, 'native' | 'host' | 'unknown'>;
  accountAccess: 'unknown';
  usageCoverage: 'native-reported-partial';
  activityReplay: 'bounded-process-history';
  notes: string[];
}
export interface RuntimeInspection extends ResolvedAgentCapabilities {
  definitionDigest: string;
  recovery: 'process' | 'durable';
}
export interface RuntimeSessionReference { version: 1; id: string }
export interface RuntimeSessionSnapshot {
  connection: 'attached' | 'reconnecting';
  activity: 'ready' | 'running' | 'waiting' | 'unknown' | 'terminal';
  activeRunId?: string;
  waitReason?: string;
  unresolvedEffects: boolean;
}
export interface RuntimeRunOptions extends AgentRunOptions { requestId?: string }
export interface RuntimeSession extends AgentSession {
  run(input: AgentRunInput, options?: RuntimeRunOptions): Promise<AgentRun>;
  reference(): RuntimeSessionReference;
  inspectState(): Promise<RuntimeSessionSnapshot>;
  getRun(runId: string): Promise<AgentRun>;
  detach(): Promise<void>;
  /** Host-only transfers within the backend's explicitly authorized directory. */
  uploadFile(request: RuntimeFileUpload): Promise<AgentArtifact>;
  downloadArtifact(request: RuntimeArtifactDownload): Promise<{ path: string; bytes: number; mediaType: string }>;
}
export interface RuntimeDefinitionAgent {
  readonly definition: Readonly<RuntimeAgentDefinition>;
  inspect(options: RuntimeSessionOptions): Promise<RuntimeInspection>;
  openSession(options: RuntimeSessionOptions): Promise<RuntimeSession>;
}
export interface RuntimeResumeOptions {
  context: TrustedRuntimeContext;
  observation?: AgentObservationOptions;
}

export interface RuntimeFileUpload {
  /** Relative path within the host-authorized transfer directory. */
  path: string;
  /** Single portable filename, defaulting to the source filename. */
  name?: string;
  mediaType: string;
}
export interface RuntimeArtifactDownload {
  reference: string;
  /** New relative file within the host-authorized transfer directory; never overwritten. */
  path: string;
}
