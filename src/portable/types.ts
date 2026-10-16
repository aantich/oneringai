import type { AgentConfig, AgentRuntimeConfigSnapshot } from '../core/Agent.js';
import type { AgentContextNextGen } from '../core/context-nextgen/AgentContextNextGen.js';
import type {
  AgentContextNextGenConfig,
  AuthIdentity,
  ResolvedContextFeatures,
} from '../core/context-nextgen/types.js';
import type { Connector } from '../core/Connector.js';
import type { FunctionToolDefinition, ToolFunction } from '../domain/entities/Tool.js';
import type { ToolPermissionConfig } from '../domain/entities/Tool.js';
import type { SerializedContextState } from '../domain/interfaces/IContextStorage.js';

/** Wire compatibility version for portable agent packages and remote tool calls. */
export const AGENT_PACKAGE_PROTOCOL_VERSION = 2 as const;

export type AgentPackageProtocolVersion = typeof AGENT_PACKAGE_PROTOCOL_VERSION;

export type PortableToolPlacement = 'local' | 'remote';

/**
 * Runtime options that are safe to carry across an application boundary.
 * Arbitrary vendor options, provider-hosted tools, and data-governance policy
 * are omitted. The receiving trusted host must reconstruct them through
 * `HydrateAgentPackageOptions.agentConfig`.
 */
export type PortableAgentRuntimeConfig = Omit<
  AgentRuntimeConfigSnapshot,
  'vendorOptions' | 'nativeTools' | 'promptCache' | 'dataHandling'
>;

/** Serializable tool metadata. Executable code is resolved by the receiving runtime. */
export interface PortableToolDescriptor {
  definition: FunctionToolDefinition;
  placement: PortableToolPlacement;
  /** Informational only. Hydration ignores this unless a trusted host resolves it. */
  permission?: ToolPermissionConfig;
  /**
   * Local tools identify the executable selected by the trusted host; remote
   * tools carry a canonical definition fingerprint for wire consistency.
   */
  implementationFingerprint: string;
  namespace?: string;
  category?: string;
  tags?: string[];
}

export interface PortableAgentContext {
  features: ResolvedContextFeatures;
  pluginNames: string[];
  state: SerializedContextState;
}

/** Provider-neutral Realtime profile. Provider credentials are deliberately excluded. */
export interface PortableRealtimeProfile {
  provider: string;
  connectorName: string;
  model: string;
  voice?: string;
}

/**
 * Data-only snapshot used to recreate one effective agent in another trusted
 * application process. It is an execution package, not an authorization token,
 * credential store, or authoritative agent catalog.
 */
export interface SerializedAgentPackage {
  protocolVersion: AgentPackageProtocolVersion;
  packageId: string;
  createdAt: string;
  expiresAt?: string;
  revision?: string | number;
  agent: {
    id: string;
    name: string;
    connector: {
      name: string;
      model: string;
    };
    instructions?: string;
    runtime: PortableAgentRuntimeConfig;
    context: PortableAgentContext;
    tools: PortableToolDescriptor[];
    realtime?: PortableRealtimeProfile;
  };
  metadata?: Record<string, unknown>;
}

export type PortableToolPlacementResolver = (
  toolName: string,
  definition: FunctionToolDefinition,
) => PortableToolPlacement | 'omit';

export interface ExportAgentPackageOptions {
  packageId?: string;
  expiresAt?: string | Date;
  revision?: string | number;
  metadata?: Record<string, unknown>;
  realtime?: PortableRealtimeProfile;
  /**
   * Explicit unrendered instruction template. Required when the Agent's
   * instructions were installed by mutating its context after construction.
   */
  instructionTemplate?: string;
  /** Tools default to remote because executable functions cannot cross a wire. */
  toolPlacement?: PortableToolPlacementResolver;
  /**
   * Supply the authoritative implementation fingerprint for custom local tools.
   * Generated built-ins are fingerprinted automatically; remote tools do not
   * require an implementation-specific value.
   */
  toolImplementationFingerprint?: (
    toolName: string,
    definition: FunctionToolDefinition,
  ) => string | undefined;
  /** Override the plugin set that the receiving context must provide. */
  pluginNames?: string[];
}

export interface AgentPackageContextFactoryInput {
  package: SerializedAgentPackage;
  connector: string | Connector;
  model: string;
  userId?: string;
  identities?: AuthIdentity[];
}

export type AgentPackageContextFactory = (
  input: AgentPackageContextFactoryInput,
) => AgentContextNextGen | AgentContextNextGenConfig | Promise<AgentContextNextGen | AgentContextNextGenConfig>;

export interface ResolvedLocalTool {
  tool: ToolFunction;
  /** Must match the fingerprint selected by the exporting runtime. */
  implementationFingerprint: string;
}

export type LocalToolResolver = (
  descriptor: PortableToolDescriptor,
) => ResolvedLocalTool | undefined | Promise<ResolvedLocalTool | undefined>;

export type PortableToolPermissionResolver = (
  descriptor: PortableToolDescriptor,
) => ToolPermissionConfig | undefined;

/** Trusted connector and model selected by the receiving application host. */
export interface AgentPackageConnectorResolution {
  connector: string | Connector;
  model: string;
}

interface HydrateAgentPackageBaseOptions {
  /** Select the normal text model or the package's Realtime model. Default: text. */
  executionProfile?: 'text' | 'realtime';
  userId?: string;
  identities?: AuthIdentity[];
  localToolResolver?: LocalToolResolver;
  /** Trusted policy resolver. Descriptor permission data is never applied directly. */
  toolPermissionResolver?: PortableToolPermissionResolver;
  remoteToolTransport?: RemoteToolTransport;
  /**
   * Required host-owned context policy. Package feature flags and plugin names
   * describe serialized state but never activate plugins or broaden tools.
   */
  contextFactory: AgentPackageContextFactory;
  /** Required host-owned tool policy. Mutable packages never carry authority. */
  permissions: NonNullable<AgentConfig['permissions']>;
  userRoles?: string[];
  registry?: AgentConfig['registry'];
  hooks?: AgentConfig['hooks'];
  lifecycleHooks?: AgentConfig['lifecycleHooks'];
  /**
   * Trusted host overrides. This is also where omitted vendor options,
   * provider-hosted tools, prompt caching, and data-handling policy can be
   * reconstructed. Managed loop callbacks and helper/task configuration also
   * come only from this trusted host, never from the serialized package.
   * Connector, model, executable tools, context, and identity
   * fields are supplied through dedicated options.
   */
  agentConfig?: Partial<AgentRuntimeConfigSnapshot> & Pick<AgentConfig, 'loopPolicy' | 'modelExecution'>;
}

/**
 * Hydration always requires the trusted host to select both connector and
 * model. Package values are hints for the resolver, never authorization.
 */
export type HydrateAgentPackageOptions = HydrateAgentPackageBaseOptions & (
  | {
      connector: string | Connector;
      model: string;
      connectorResolver?: never;
    }
  | {
      connector?: never;
      model?: never;
      connectorResolver: (
        reference: SerializedAgentPackage['agent']['connector'],
        profile: 'text' | 'realtime',
      ) => AgentPackageConnectorResolution | Promise<AgentPackageConnectorResolution>;
    }
);

export interface RemoteToolExecutionRequest {
  protocolVersion: AgentPackageProtocolVersion;
  packageId: string;
  requestId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface RemoteToolError {
  code: string;
  message: string;
  retryable?: boolean;
}

export type RemoteToolExecutionResponse =
  | {
      protocolVersion: AgentPackageProtocolVersion;
      packageId: string;
      requestId: string;
      ok: true;
      result: unknown;
    }
  | {
      protocolVersion: AgentPackageProtocolVersion;
      packageId: string;
      requestId: string;
      ok: false;
      error: RemoteToolError;
    };

/** Host-supplied authenticated transport. OneRingAI owns the wire DTO and proxy tool behavior. */
export interface RemoteToolTransport {
  execute(
    request: RemoteToolExecutionRequest,
    options?: { signal?: AbortSignal },
  ): Promise<RemoteToolExecutionResponse>;
}
