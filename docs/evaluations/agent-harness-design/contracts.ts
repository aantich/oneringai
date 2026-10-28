/**
 * Compile-only revision 2 design prototype. This file implements no runtime API.
 * Uses the current built public package, not implementation source paths.
 */
import type {
  AgentCapabilityRequirement,
  AgentDriver,
  AgentExecutionBackend,
  AgentInspectionRequest,
  AgentRun,
  AgentRunInput,
  AgentRunOptions,
  AgentRunEventType,
  AgentRunStatus,
  AgentSession,
  AgentSessionState,
  DriverDescriptor,
  DriverInspectionContext,
  DriverOpenSessionRequest,
  DriverRun,
  DriverSession,
  JsonObject,
  OpenAgentSessionOptions,
  ResolvedAgentCapabilities,
  RuntimeAgentSpec,
  RuntimeReasoningConfig,
  TrustedRuntimeContext,
} from '@everworker/oneringai/agent-runtime';
import type { AgentRuntime } from '@everworker/oneringai/agent-runtime';
import type { CodexOptions } from '@openai/codex-sdk';

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
}
export interface RuntimeDefinitionAgent {
  readonly definition: Readonly<RuntimeAgentDefinition>;
  inspect(options: RuntimeSessionOptions): Promise<RuntimeInspection>;
  openSession(options: RuntimeSessionOptions): Promise<RuntimeSession>;
}
export interface ExpandedRuntime extends AgentRuntime {
  createAgent(definition: RuntimeAgentDefinition): RuntimeDefinitionAgent;
  resumeSession(reference: RuntimeSessionReference, options: {
    context: TrustedRuntimeContext;
  }): Promise<RuntimeSession>;
  deleteSession(reference: RuntimeSessionReference, options: {
    context: TrustedRuntimeContext;
  }): Promise<void>;
}

// Prototype only optional additions to the existing driver/backend interfaces.
export interface ExpandedSpec extends RuntimeAgentSpec {
  definition?: RuntimeAgentDefinition;
}
export interface ExpandedInspection extends DriverInspectionContext {
  spec: Readonly<ExpandedSpec>;
  environment?: JsonObject;
}
export interface ExpandedOpen extends DriverOpenSessionRequest {
  spec: Readonly<ExpandedSpec>;
  environment?: JsonObject;
}
export interface ExpandedDriverSession extends DriverSession {
  checkpoint?(): Promise<JsonObject>;
  inspectState?(): Promise<RuntimeSessionSnapshot>;
  detach?(): Promise<void>;
}
export interface ExpandedDriver extends AgentDriver {
  inspect(context: ExpandedInspection): Promise<DriverDescriptor>;
  openSession(request: ExpandedOpen): Promise<ExpandedDriverSession>;
  restoreSession?(request: ExpandedOpen & { checkpoint: JsonObject }): Promise<{
    session: ExpandedDriverSession;
    activeRun?: DriverRun;
  }>;
}
export interface ExpandedBackend extends AgentExecutionBackend {
  resumeSession?(reference: RuntimeSessionReference, options: {
    context: TrustedRuntimeContext;
  }): Promise<RuntimeSession>;
  deleteSession?(reference: RuntimeSessionReference, options: {
    context: TrustedRuntimeContext;
  }): Promise<void>;
}

declare const oldDriver: AgentDriver;
declare const oldBackend: AgentExecutionBackend;
declare const newSession: RuntimeSession;
declare const sessionOptions: RuntimeSessionOptions;

// Existing implementations remain assignable; new sessions remain consumable
// through the old session interface, and richer options retain the old fields.
export const compatibleDriver: ExpandedDriver = oldDriver;
export const compatibleBackend: ExpandedBackend = oldBackend;
export const compatibleSession: AgentSession = newSession;
export const compatibleOptions: OpenAgentSessionOptions = sessionOptions;

// New optional fields do not require widening the existing workspace union.
export const legacyInspection: AgentInspectionRequest = {
  workspace: { type: 'local-directory', path: '/workspace' },
};
export const oldStatusValues = {
  completed: true, failed: true, cancelled: true, incomplete: true,
} satisfies Record<AgentRunStatus, boolean>;
export const oldStateValues = {
  opening: true, ready: true, running: true, failed: true,
  destroying: true, destroyed: true,
} satisfies Record<AgentSessionState, boolean>;
export const oldEventValues = {
  'run.started': true,
  'agent.message.delta': true,
  'agent.message.completed': true,
  'reasoning.delta': true,
  'reasoning.completed': true,
  'plan.updated': true,
  'agent.iteration.completed': true,
  'command.started': true,
  'command.output.delta': true,
  'command.completed': true,
  'file.change.started': true,
  'file.changed': true,
  'tool.started': true,
  'tool.progress': true,
  'tool.completed': true,
  'interaction.requested': true,
  'interaction.resolved': true,
  'usage.updated': true,
  'diagnostic': true,
  'run.finished': true,
} satisfies Record<AgentRunEventType, boolean>;

// Confirms the installed SDK accepts the proposed configuration shape. It does
// not prove that a live Codex process initializes or invokes the MCP server.
export const codexMcpConfiguration: CodexOptions = {
  config: {
    mcp_servers: {
      onering_host: {
        url: 'http://127.0.0.1:12345/mcp',
        bearer_token_env_var: 'ONERINGAI_HOST_BROKER_TOKEN',
        enabled_tools: ['search_records', 'read_record'],
        required: true,
      },
    },
  },
};
