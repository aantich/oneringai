import { createHash, randomUUID } from 'crypto';
import { Agent, type AgentRuntimeConfigSnapshot } from '../core/Agent.js';
import type { ToolFunction } from '../domain/entities/Tool.js';
import { ToolCallState } from '../domain/entities/Tool.js';
import { getToolByName } from '../tools/registry.generated.js';
import {
  AGENT_PACKAGE_PROTOCOL_VERSION,
  type ExportAgentPackageOptions,
  type HydrateAgentPackageOptions,
  type PortableAgentRuntimeConfig,
  type PortableToolDescriptor,
  type ResolvedLocalTool,
  type RemoteToolExecutionRequest,
  type RemoteToolExecutionResponse,
  type RemoteToolTransport,
  type SerializedAgentPackage,
} from './types.js';

const MAX_REMOTE_TOOL_NAME_LENGTH = 256;
const MAX_REMOTE_REQUEST_ID_LENGTH = 256;
const MAX_REMOTE_ERROR_CODE_LENGTH = 128;
const MAX_REMOTE_ERROR_MESSAGE_LENGTH = 512;
const MAX_PACKAGE_ID_LENGTH = 256;
const MAX_AGENT_NAME_LENGTH = 512;
const MAX_INSTRUCTIONS_LENGTH = 1_000_000;
const MAX_TOOLS = 512;
const MAX_PLUGINS = 128;
const MAX_TAGS_PER_TOOL = 64;
const MAX_METADATA_STRING_LENGTH = 512;
const MAX_REMOTE_REQUESTS = 1_000;
const MAX_REMOTE_ARGUMENT_BYTES = 1_000_000;
const MAX_REMOTE_RESULT_BYTES = 1_000_000;
const MAX_CONTEXT_MESSAGES = 10_000;
const MAX_CONTENT_ITEMS_PER_MESSAGE = 10_000;
const MAX_PACKAGE_BYTES = 10_000_000;
const REQUIRED_CONTEXT_FEATURE_KEYS = [
  'workingMemory',
  'inContextMemory',
  'persistentInstructions',
  'userInfo',
  'toolCatalog',
  'sharedWorkspace',
  'memory',
  'memoryWrite',
] as const;
const PORTABLE_RUNTIME_KEYS = new Set([
  'temperature',
  'maxIterations',
  'thinking',
  'toolExecutionTimeout',
  'historyMode',
  'limits',
  'errorHandling',
  'asyncTools',
  'emptyResponseRetry',
]);

export class AgentPackageCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentPackageCompatibilityError';
  }
}

export class RemoteToolExecutionError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'RemoteToolExecutionError';
    this.code = code;
    this.retryable = retryable;
  }
}

/** Export one already-resolved Agent as a data-only package for another runtime. */
export function exportAgentPackage(
  agent: Agent,
  options: ExportAgentPackageOptions = {},
): SerializedAgentPackage {
  if (agent.isDestroyed) throw new Error('Cannot export a destroyed Agent');
  if (agent.isRunning()) throw new Error('Cannot export an Agent while it is executing');
  const packageId = options.packageId ?? randomUUID();
  assertNonEmptyString(packageId, 'packageId');

  const resolvedDefinitions = new Map(
    agent.getToolDefinitions().map((definition) => [definition.function.name, definition]),
  );
  const contextToolNames = new Set(agent.context.getContextToolNames());
  const tools: PortableToolDescriptor[] = [];

  for (const toolName of agent.listTools()) {
    // Context plugins recreate these functions against the receiving context.
    // Exporting proxies would overwrite them and split plugin state across hosts.
    if (contextToolNames.has(toolName)) continue;
    const definition = resolvedDefinitions.get(toolName);
    if (!definition) continue;
    const placement = options.toolPlacement?.(toolName, definition) ?? 'remote';
    if (placement === 'omit') continue;
    const registration = agent.tools.getRegistration(toolName);
    const permission = registration?.permission ?? registration?.tool.permission;
    const definitionFingerprint = createPortableToolDefinitionFingerprint(definition);
    const explicitFingerprint = placement === 'local'
      ? options.toolImplementationFingerprint?.(toolName, definition)
      : undefined;
    const builtInFingerprint = placement === 'local' && registration
      ? getBuiltInToolFingerprint(registration.tool, registration.tool.definition)
      : undefined;
    if (placement === 'local'
      && (!explicitFingerprint || explicitFingerprint === definitionFingerprint)
      && !builtInFingerprint) {
      throw new AgentPackageCompatibilityError(
        `Local tool '${toolName}' requires an authoritative implementation fingerprint`,
      );
    }
    tools.push(cloneJson({
      definition,
      placement,
      implementationFingerprint: placement === 'local'
        ? explicitFingerprint ?? builtInFingerprint!
        : definitionFingerprint,
      ...(permission ? { permission } : {}),
      ...(registration?.namespace && registration.namespace !== 'default'
        ? { namespace: registration.namespace }
        : {}),
      ...(registration?.category ? { category: registration.category } : {}),
      ...(registration?.tags?.length ? { tags: registration.tags } : {}),
    }));
  }

  const expiresAt = options.expiresAt instanceof Date
    ? options.expiresAt.toISOString()
    : options.expiresAt;
  if (expiresAt !== undefined && !Number.isFinite(Date.parse(expiresAt))) {
    throw new RangeError('expiresAt must be a valid ISO timestamp or Date');
  }

  const runtimeSnapshot = agent.getRuntimeConfigSnapshot({ includeHostLocal: false });
  // This explicit allowlist is the portable authority boundary. Open-ended
  // provider configuration and data-governance policy are host-local and must
  // be supplied by trusted HydrateAgentPackageOptions.agentConfig.
  const runtime: PortableAgentRuntimeConfig = cloneJson({
    ...(runtimeSnapshot.temperature !== undefined
      ? { temperature: runtimeSnapshot.temperature }
      : {}),
    ...(runtimeSnapshot.maxIterations !== undefined
      ? { maxIterations: runtimeSnapshot.maxIterations }
      : {}),
    ...(runtimeSnapshot.thinking ? { thinking: runtimeSnapshot.thinking } : {}),
    ...(runtimeSnapshot.toolExecutionTimeout !== undefined
      ? { toolExecutionTimeout: runtimeSnapshot.toolExecutionTimeout }
      : {}),
    ...(runtimeSnapshot.historyMode ? { historyMode: runtimeSnapshot.historyMode } : {}),
    ...(runtimeSnapshot.limits ? { limits: runtimeSnapshot.limits } : {}),
    ...(runtimeSnapshot.errorHandling ? { errorHandling: runtimeSnapshot.errorHandling } : {}),
    ...(runtimeSnapshot.asyncTools ? { asyncTools: runtimeSnapshot.asyncTools } : {}),
    ...(runtimeSnapshot.emptyResponseRetry
      ? { emptyResponseRetry: runtimeSnapshot.emptyResponseRetry }
      : {}),
  });
  const storedInstructionTemplate = agent.getInstructionTemplate();
  if (options.instructionTemplate === undefined
    && agent.context.systemPrompt !== agent.getRenderedInstructionTemplate()) {
    throw new Error(
      'Agent context instructions changed after creation; provide the effective unrendered ExportAgentPackageOptions.instructionTemplate',
    );
  }
  const instructionTemplate = options.instructionTemplate ?? storedInstructionTemplate;
  const contextState = cloneJson(agent.context.getState());
  // The package-level instructions field is the single prompt authority. A
  // second copy in context state would silently undo an allowed host edit.
  delete contextState.systemPrompt;
  if (contextState.metadata) {
    // Runtime identity is always supplied by the receiving trusted host. Keep
    // diagnostic model/agent metadata, but never transfer the source actor.
    delete contextState.metadata.userId;
  }
  const packageValue: SerializedAgentPackage = {
    protocolVersion: AGENT_PACKAGE_PROTOCOL_VERSION,
    packageId,
    createdAt: new Date().toISOString(),
    ...(expiresAt ? { expiresAt } : {}),
    ...(options.revision !== undefined ? { revision: options.revision } : {}),
    agent: {
      id: agent.context.agentId,
      name: agent.name,
      connector: {
        name: agent.connector.name,
        model: agent.model,
      },
      ...(instructionTemplate !== undefined ? { instructions: instructionTemplate } : {}),
      runtime,
      context: {
        features: cloneJson(agent.context.features),
        pluginNames: options.pluginNames
          ? [...options.pluginNames]
          : agent.context.getPlugins().map((plugin) => plugin.name),
        state: contextState,
      },
      tools,
      ...(options.realtime ? { realtime: cloneJson(options.realtime) } : {}),
    },
    ...(options.metadata ? { metadata: cloneJson(options.metadata) } : {}),
  };
  assertAgentPackageCompatible(packageValue);
  return packageValue;
}

/** Recreate an Agent from a portable package using trusted host connector and tool resolvers. */
export async function hydrateAgentPackage(
  packageValue: SerializedAgentPackage,
  options: HydrateAgentPackageOptions,
): Promise<Agent> {
  return hydrateAgentPackageWithToolFactory(packageValue, options);
}

/** @internal One construction/restore engine; negotiated callers supply their explicit proxy factory. */
export async function hydrateAgentPackageWithToolFactory(
  packageValue: SerializedAgentPackage,
  options: HydrateAgentPackageOptions,
  remoteFactory?: (packageId: string, descriptor: PortableToolDescriptor) => ToolFunction | Promise<ToolFunction>,
): Promise<Agent> {
  assertAgentPackageCompatible(packageValue);
  if (!options || !isRecord(options)) {
    throw new AgentPackageCompatibilityError('Trusted hydration options are required');
  }
  if (!isRecord(options.permissions)) {
    throw new AgentPackageCompatibilityError('Trusted host permissions are required');
  }
  if (typeof options.contextFactory !== 'function') {
    throw new AgentPackageCompatibilityError('Trusted host contextFactory is required');
  }
  if (packageValue.expiresAt && Date.parse(packageValue.expiresAt) <= Date.now()) {
    throw new AgentPackageCompatibilityError(`Agent package '${packageValue.packageId}' has expired`);
  }

  const executionProfile = options.executionProfile ?? 'text';
  const connectorReference = resolveExecutionConnector(packageValue, executionProfile);
  const resolution = options.connectorResolver
    ? await options.connectorResolver(connectorReference, executionProfile)
    : { connector: options.connector, model: options.model };
  if (typeof resolution.connector === 'string') {
    assertNonEmptyString(resolution.connector, 'resolved connector');
  }
  assertNonEmptyString(resolution.model, 'resolved model');
  const hydratedTools = await hydrateTools(packageValue, options, remoteFactory);
  const context = await options.contextFactory({
    package: packageValue,
    connector: resolution.connector,
    model: resolution.model,
    userId: options.userId,
    identities: options.identities,
  });

  const runtime: AgentRuntimeConfigSnapshot = {
    ...packageValue.agent.runtime,
    ...options.agentConfig,
  };
  const agent = Agent.create({
    ...runtime,
    connector: resolution.connector,
    model: resolution.model,
    name: packageValue.agent.name,
    instructions: packageValue.agent.instructions,
    context,
    userId: options.userId,
    identities: options.identities,
    permissions: options.permissions,
    userRoles: options.userRoles,
    registry: options.registry,
    hooks: options.hooks,
    lifecycleHooks: options.lifecycleHooks,
  });

  try {
    const availablePlugins = new Set(agent.context.getPlugins().map((plugin) => plugin.name));
    const missingPlugins = packageValue.agent.context.pluginNames.filter(
      (pluginName) => !availablePlugins.has(pluginName),
    );
    if (missingPlugins.length > 0) {
      throw new AgentPackageCompatibilityError(
        `Agent package requires unavailable context plugins: ${missingPlugins.join(', ')}`,
      );
    }
    const trustedToolNames = new Set(agent.listTools());
    for (const { descriptor } of hydratedTools) {
      const toolName = descriptor.definition.function.name;
      if (trustedToolNames.has(toolName)) {
        throw new AgentPackageCompatibilityError(
          `Portable tool '${toolName}' conflicts with a trusted host tool`,
        );
      }
    }
    for (const { descriptor, tool } of hydratedTools) {
      const permission = options.toolPermissionResolver?.(descriptor);
      agent.tools.register(tool, {
        ...(descriptor.namespace ? { namespace: descriptor.namespace } : {}),
        ...(descriptor.category ? { category: descriptor.category } : {}),
        ...(descriptor.tags ? { tags: [...descriptor.tags] } : {}),
        ...(permission ? { permission } : {}),
      });
    }
    const contextState = cloneJson(packageValue.agent.context.state);
    // Agent.create rendered the package's untrusted template using the trusted
    // receiving identity/model. Preserve that rendered value across restore.
    contextState.systemPrompt = agent.context.systemPrompt;
    contextState.metadata.agentId = packageValue.agent.id;
    contextState.metadata.model = resolution.model;
    if (options.userId === undefined) delete contextState.metadata.userId;
    else contextState.metadata.userId = options.userId;
    agent.context.restoreState(contextState);
    return agent;
  } catch (error) {
    agent.destroy();
    throw error;
  }
}

/** Validate the public protocol version and the bounded fields used for routing. */
export function assertAgentPackageCompatible(packageValue: SerializedAgentPackage): void {
  const wire: unknown = packageValue;
  if (!isRecord(wire)) {
    throw new AgentPackageCompatibilityError('Agent package must be an object');
  }
  assertJsonValue(wire, 'Agent package');
  let serialized: string;
  try {
    serialized = JSON.stringify(wire);
  } catch {
    throw new AgentPackageCompatibilityError('Agent package must be JSON-serializable');
  }
  if (utf8ByteLength(serialized) > MAX_PACKAGE_BYTES) {
    throw new AgentPackageCompatibilityError(`Agent package exceeds ${MAX_PACKAGE_BYTES} bytes`);
  }
  assertOnlyKeys(wire, [
    'protocolVersion', 'packageId', 'createdAt', 'expiresAt', 'revision', 'agent', 'metadata',
  ], 'agent package');
  if (wire.protocolVersion !== AGENT_PACKAGE_PROTOCOL_VERSION) {
    throw new AgentPackageCompatibilityError(
      `Unsupported agent package protocol version '${String(wire.protocolVersion)}'; expected ${AGENT_PACKAGE_PROTOCOL_VERSION}`,
    );
  }
  assertBoundedString(wire.packageId, 'packageId', MAX_PACKAGE_ID_LENGTH);
  assertTimestamp(wire.createdAt, 'createdAt');
  if (wire.expiresAt !== undefined) assertTimestamp(wire.expiresAt, 'expiresAt');
  if (wire.revision !== undefined
    && !(typeof wire.revision === 'string' && wire.revision.length <= MAX_METADATA_STRING_LENGTH)
    && !(typeof wire.revision === 'number' && Number.isFinite(wire.revision))) {
    throw new AgentPackageCompatibilityError('revision must be a bounded string or finite number');
  }
  if (wire.metadata !== undefined && !isRecord(wire.metadata)) {
    throw new AgentPackageCompatibilityError('metadata must be an object');
  }

  if (!isRecord(wire.agent)) throw new AgentPackageCompatibilityError('agent must be an object');
  const agent = wire.agent;
  assertOnlyKeys(agent, [
    'id', 'name', 'connector', 'instructions', 'runtime', 'context', 'tools', 'realtime',
  ], 'agent');
  assertBoundedString(agent.id, 'agent.id', MAX_AGENT_NAME_LENGTH);
  assertBoundedString(agent.name, 'agent.name', MAX_AGENT_NAME_LENGTH);
  if (agent.instructions !== undefined
    && (typeof agent.instructions !== 'string' || agent.instructions.length > MAX_INSTRUCTIONS_LENGTH)) {
    throw new AgentPackageCompatibilityError(
      `agent.instructions must be a string of at most ${MAX_INSTRUCTIONS_LENGTH} characters`,
    );
  }
  if (!isRecord(agent.connector)) {
    throw new AgentPackageCompatibilityError('agent.connector must be an object');
  }
  assertOnlyKeys(agent.connector, ['name', 'model'], 'agent.connector');
  assertBoundedString(agent.connector.name, 'agent.connector.name', MAX_METADATA_STRING_LENGTH);
  assertBoundedString(agent.connector.model, 'agent.connector.model', MAX_METADATA_STRING_LENGTH);

  validatePortableRuntime(agent.runtime);
  validatePortableContext(agent.context);
  if (!Array.isArray(agent.tools)) {
    throw new AgentPackageCompatibilityError('agent.tools must be an array');
  }
  if (agent.tools.length > MAX_TOOLS) {
    throw new AgentPackageCompatibilityError(`agent.tools exceeds ${MAX_TOOLS} entries`);
  }
  const toolNames = new Set<string>();
  for (let index = 0; index < agent.tools.length; index++) {
    validatePortableTool(agent.tools[index], index, toolNames);
  }
  if (agent.realtime !== undefined) validateRealtimeProfile(agent.realtime);
}

/** Build a normal ToolFunction whose execution is delegated through a typed transport. */
export function createRemoteTool(
  packageId: string,
  descriptor: PortableToolDescriptor,
  transport: RemoteToolTransport,
): ToolFunction {
  return {
    definition: cloneJson(descriptor.definition),
    execute: async (args: Record<string, unknown>, context) => {
      const request: RemoteToolExecutionRequest = {
        protocolVersion: AGENT_PACKAGE_PROTOCOL_VERSION,
        packageId,
        requestId: randomUUID(),
        toolName: descriptor.definition.function.name,
        arguments: cloneJson(args ?? {}),
      };
      const response: unknown = await transport.execute(request, { signal: context?.signal });
      assertRemoteToolResponse(response, request);
      if (!response.ok) {
        throw new RemoteToolExecutionError(
          response.error.code,
          response.error.message,
          response.error.retryable ?? false,
        );
      }
      return cloneJson(response.result);
    },
  };
}

/**
 * Session-bound server executor for tools exported as `remote`. The host must
 * authenticate and authorize every request before calling `execute()`.
 */
export class AgentPackageToolServer {
  private readonly remoteTools: Set<string>;
  private readonly activeExecutions = new Set<Promise<RemoteToolExecutionResponse>>();
  private readonly requestExecutions = new Map<string, {
    fingerprint: string;
    promise: Promise<RemoteToolExecutionResponse>;
  }>();
  private startPromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private started = false;
  private closed = false;

  constructor(
    private readonly agent: Agent,
    private readonly packageValue: SerializedAgentPackage,
  ) {
    assertAgentPackageCompatible(packageValue);
    this.remoteTools = new Set(
      packageValue.agent.tools
        .filter((tool) => tool.placement === 'remote')
        .map((tool) => tool.definition.function.name),
    );
    const contextToolNames = new Set(agent.context.getContextToolNames());
    const contextCollision = [...this.remoteTools].find((name) => contextToolNames.has(name));
    if (contextCollision) {
      throw new AgentPackageCompatibilityError(
        `Remote tool '${contextCollision}' conflicts with a source context tool`,
      );
    }
  }

  async start(): Promise<void> {
    if (this.closed) throw new Error('Agent package tool server is closed');
    if (this.started) return;
    if (!this.startPromise) {
      this.startPromise = this.agent.beginExternalExecution({ source: 'agent-package-tools' })
        .then(() => { this.started = true; })
        .finally(() => { this.startPromise = null; });
    }
    await this.startPromise;
  }

  async execute(input: unknown): Promise<RemoteToolExecutionResponse> {
    let request: RemoteToolExecutionRequest;
    try {
      request = parseRemoteToolRequest(input, this.packageValue.packageId);
    } catch (error) {
      const fallback = fallbackRemoteRequest(input, this.packageValue.packageId);
      return failureResponse(fallback, 'invalid_request', errorMessage(error));
    }
    if (this.closed) return failureResponse(request, 'session_closed', 'Remote tool session is closed');
    if (!this.remoteTools.has(request.toolName)) {
      return failureResponse(request, 'tool_not_allowed', `Tool '${request.toolName}' is not enabled for remote execution`);
    }

    const fingerprint = remoteRequestFingerprint(request);
    const existing = this.requestExecutions.get(request.requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return failureResponse(
          request,
          'invalid_request',
          `requestId '${request.requestId}' was already used for a different tool request`,
        );
      }
      return existing.promise;
    }
    if (this.requestExecutions.size >= MAX_REMOTE_REQUESTS) {
      return failureResponse(
        request,
        'request_limit_exceeded',
        `Remote tool session exceeds ${MAX_REMOTE_REQUESTS} distinct requests`,
      );
    }

    const task = this.executeAllowed(request);
    this.requestExecutions.set(request.requestId, { fingerprint, promise: task });
    this.activeExecutions.add(task);
    try {
      return await task;
    } finally {
      this.activeExecutions.delete(task);
    }
  }

  private async executeAllowed(
    request: RemoteToolExecutionRequest,
  ): Promise<RemoteToolExecutionResponse> {
    try {
      await this.start();
      const result = await this.agent.executeExternalToolCall({
        id: request.requestId,
        name: request.toolName,
        arguments: request.arguments,
      });
      if (result.error
        || result.state === ToolCallState.FAILED
        || result.state === ToolCallState.TIMEOUT
        || isNormalizedToolFailure(result.content)) {
        return failureResponse(request, 'tool_failed', `Tool '${request.toolName}' failed`);
      }
      const safeResult = cloneBoundedJson(
        result.content,
        'remote tool result',
        MAX_REMOTE_RESULT_BYTES,
      );
      return {
        protocolVersion: AGENT_PACKAGE_PROTOCOL_VERSION,
        packageId: request.packageId,
        requestId: request.requestId,
        ok: true,
        result: safeResult,
      };
    } catch {
      return failureResponse(request, 'tool_failed', `Tool '${request.toolName}' failed`);
    }
  }

  close(status: 'completed' | 'failed' | 'cancelled' = 'completed'): Promise<void> {
    if (status === 'cancelled') this.agent.cancel();
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closePromise = this.finishClose(status);
    return this.closePromise;
  }

  private async finishClose(status: 'completed' | 'failed' | 'cancelled'): Promise<void> {
    if (this.startPromise) await Promise.allSettled([this.startPromise]);
    await Promise.allSettled([...this.activeExecutions]);
    if (this.started) {
      try {
        await this.agent.completeExternalExecution({ status });
      } finally {
        this.started = false;
      }
    }
  }
}

interface HydratedPortableTool {
  descriptor: PortableToolDescriptor;
  tool: ToolFunction;
}

/**
 * Create the stable wire fingerprint used to reject mismatched local
 * executables. Dynamic function descriptions are excluded from the executable
 * contract because each host regenerates them from its own trusted context.
 */
export function createPortableToolImplementationFingerprint(
  definition: PortableToolDescriptor['definition'],
  implementationId: string,
): string {
  if (typeof implementationId !== 'string' || !implementationId.trim()) {
    throw new TypeError('implementationId must be a non-empty string');
  }
  return createPortableToolFingerprint(
    createPortableToolImplementationContract(definition),
    implementationId,
  );
}

function createPortableToolDefinitionFingerprint(
  definition: PortableToolDescriptor['definition'],
): string {
  return createPortableToolFingerprint(definition);
}

/**
 * Dynamic function descriptions are prompt presentation, not executable
 * compatibility. Keep the callable schema and execution metadata while
 * canonicalizing optional values exactly as they cross the JSON wire.
 */
function createPortableToolImplementationContract(
  definition: PortableToolDescriptor['definition'],
): PortableToolDescriptor['definition'] {
  const contract = cloneJson(definition);
  delete contract.function.description;
  return contract;
}

function createPortableToolFingerprint(
  definition: PortableToolDescriptor['definition'],
  implementationId?: string,
): string {
  const hash = createHash('sha256');
  hash.update('oneringai-portable-tool-v2\0');
  hash.update(stableWireJson(definition));
  if (implementationId !== undefined) {
    hash.update('\0');
    hash.update(implementationId);
  }
  return `sha256:${hash.digest('hex')}`;
}

/**
 * Resolve a trusted local executable with a fingerprint suitable for package
 * hydration. Custom tools require a stable implementation ID shared by the
 * exporting and receiving runtimes. Generated built-ins use registry metadata.
 */
export function createResolvedLocalTool(
  tool: ToolFunction,
  implementationId?: string,
): ResolvedLocalTool {
  const implementationFingerprint = implementationId === undefined
    ? getBuiltInToolFingerprint(tool, tool.definition)
    : createPortableToolImplementationFingerprint(tool.definition, implementationId);
  if (!implementationFingerprint) {
    throw new TypeError(
      `Custom local tool '${tool.definition.function.name}' requires a stable implementationId`,
    );
  }
  return { tool, implementationFingerprint };
}

function getBuiltInToolFingerprint(
  tool: ToolFunction,
  definition: PortableToolDescriptor['definition'],
): string | undefined {
  const entry = getToolByName(definition.function.name);
  if (!entry?.implementationHash || entry.tool !== tool) return undefined;
  return createPortableToolImplementationFingerprint(definition, entry.implementationHash);
}

async function hydrateTools(
  packageValue: SerializedAgentPackage,
  options: HydrateAgentPackageOptions,
  remoteFactory?: (packageId: string, descriptor: PortableToolDescriptor) => ToolFunction | Promise<ToolFunction>,
): Promise<HydratedPortableTool[]> {
  const tools: HydratedPortableTool[] = [];
  for (const descriptor of packageValue.agent.tools) {
    if (descriptor.placement === 'remote') {
      if (remoteFactory) { tools.push({ descriptor, tool: await remoteFactory(packageValue.packageId, descriptor) }); continue; }
      if (!options.remoteToolTransport) {
        throw new AgentPackageCompatibilityError(
          `Remote tool '${descriptor.definition.function.name}' requires remoteToolTransport`,
        );
      }
      tools.push({
        descriptor,
        tool: createRemoteTool(packageValue.packageId, descriptor, options.remoteToolTransport),
      });
      continue;
    }
    const resolution = await options.localToolResolver?.(descriptor);
    if (!resolution) {
      throw new AgentPackageCompatibilityError(
        `Local tool '${descriptor.definition.function.name}' could not be resolved`,
      );
    }
    if (!isRecord(resolution)
      || !isRecord(resolution.tool)
      || !isRecord(resolution.tool.definition)
      || !isRecord(resolution.tool.definition.function)
      || typeof resolution.tool.definition.function.name !== 'string'
      || typeof resolution.tool.execute !== 'function'
      || typeof resolution.implementationFingerprint !== 'string') {
      throw new AgentPackageCompatibilityError(
        `Local tool '${descriptor.definition.function.name}' resolver must return a ResolvedLocalTool with an authoritative implementation fingerprint`,
      );
    }
    const resolved = resolution.tool;
    const implementationFingerprint = resolution.implementationFingerprint;
    if (resolved.definition.function.name !== descriptor.definition.function.name) {
      throw new AgentPackageCompatibilityError(
        `Local tool resolver returned '${resolved.definition.function.name}' for '${descriptor.definition.function.name}'`,
      );
    }
    if (stableWireJson(createPortableToolImplementationContract(resolved.definition))
      !== stableWireJson(createPortableToolImplementationContract(descriptor.definition))) {
      throw new AgentPackageCompatibilityError(
        `Local tool '${descriptor.definition.function.name}' definition is incompatible with the package`,
      );
    }
    if (implementationFingerprint !== descriptor.implementationFingerprint) {
      throw new AgentPackageCompatibilityError(
        `Local tool '${descriptor.definition.function.name}' implementation is incompatible with the package`,
      );
    }
    tools.push({ descriptor, tool: resolved });
  }
  return tools;
}

function resolveExecutionConnector(
  packageValue: SerializedAgentPackage,
  profile: 'text' | 'realtime',
): SerializedAgentPackage['agent']['connector'] {
  if (profile === 'text') return packageValue.agent.connector;
  const realtime = packageValue.agent.realtime;
  if (!realtime) {
    throw new AgentPackageCompatibilityError(
      `Agent package '${packageValue.packageId}' does not define a Realtime profile`,
    );
  }
  return { name: realtime.connectorName, model: realtime.model };
}

function parseRemoteToolRequest(input: unknown, packageId: string): RemoteToolExecutionRequest {
  if (!isRecord(input)) throw new TypeError('Remote tool request must be an object');
  assertOnlyKeys(
    input,
    ['protocolVersion', 'packageId', 'requestId', 'toolName', 'arguments'],
    'remote tool request',
  );
  if (input.protocolVersion !== AGENT_PACKAGE_PROTOCOL_VERSION) {
    throw new AgentPackageCompatibilityError('Unsupported remote tool protocol version');
  }
  if (input.packageId !== packageId) throw new Error('Remote tool packageId does not match this session');
  assertBoundedString(input.requestId, 'requestId', MAX_REMOTE_REQUEST_ID_LENGTH);
  assertBoundedString(input.toolName, 'toolName', MAX_REMOTE_TOOL_NAME_LENGTH);
  if (!isRecord(input.arguments)) throw new TypeError('Remote tool arguments must be an object');
  const args = cloneBoundedJson(
    input.arguments,
    'arguments',
    MAX_REMOTE_ARGUMENT_BYTES,
  );
  return {
    protocolVersion: AGENT_PACKAGE_PROTOCOL_VERSION,
    packageId,
    requestId: input.requestId,
    toolName: input.toolName,
    arguments: args,
  };
}

function fallbackRemoteRequest(input: unknown, packageId: string): RemoteToolExecutionRequest {
  const value = isRecord(input) ? input : {};
  return {
    protocolVersion: AGENT_PACKAGE_PROTOCOL_VERSION,
    packageId,
    requestId: typeof value.requestId === 'string' && value.requestId
      ? value.requestId.slice(0, MAX_REMOTE_REQUEST_ID_LENGTH)
      : 'invalid-request',
    toolName: typeof value.toolName === 'string'
      ? value.toolName.slice(0, MAX_REMOTE_TOOL_NAME_LENGTH)
      : 'unknown',
    arguments: {},
  };
}

function failureResponse(
  request: RemoteToolExecutionRequest,
  code: string,
  message: string,
): RemoteToolExecutionResponse {
  return {
    protocolVersion: AGENT_PACKAGE_PROTOCOL_VERSION,
    packageId: request.packageId,
    requestId: request.requestId,
    ok: false,
    error: { code, message: message.slice(0, MAX_REMOTE_ERROR_MESSAGE_LENGTH) },
  };
}

function assertRemoteToolResponse(
  response: unknown,
  request: RemoteToolExecutionRequest,
): asserts response is RemoteToolExecutionResponse {
  if (!isRecord(response)) {
    throw new AgentPackageCompatibilityError('Remote tool response must be an object');
  }
  if (response.protocolVersion !== AGENT_PACKAGE_PROTOCOL_VERSION
    || response.packageId !== request.packageId
    || response.requestId !== request.requestId) {
    throw new AgentPackageCompatibilityError('Remote tool response does not match its request');
  }
  if (response.ok !== true && response.ok !== false) {
    throw new AgentPackageCompatibilityError('Remote tool response ok must be boolean');
  }
  if (response.ok) {
    assertOnlyKeys(
      response,
      ['protocolVersion', 'packageId', 'requestId', 'ok', 'result'],
      'remote tool success response',
    );
    if (!Object.prototype.hasOwnProperty.call(response, 'result')) {
      throw new AgentPackageCompatibilityError('Remote tool success response must include result');
    }
    assertJsonValue(response.result, 'remote tool response result');
    assertJsonByteLimit(
      response.result,
      'remote tool response result',
      MAX_REMOTE_RESULT_BYTES,
    );
    return;
  }

  assertOnlyKeys(
    response,
    ['protocolVersion', 'packageId', 'requestId', 'ok', 'error'],
    'remote tool failure response',
  );
  if (!isRecord(response.error)) {
    throw new AgentPackageCompatibilityError('Remote tool failure response must include error');
  }
  assertOnlyKeys(response.error, ['code', 'message', 'retryable'], 'remote tool response error');
  assertBoundedString(response.error.code, 'remote tool response error.code', MAX_REMOTE_ERROR_CODE_LENGTH);
  assertBoundedString(
    response.error.message,
    'remote tool response error.message',
    MAX_REMOTE_ERROR_MESSAGE_LENGTH,
  );
  if (response.error.retryable !== undefined && typeof response.error.retryable !== 'boolean') {
    throw new AgentPackageCompatibilityError(
      'remote tool response error.retryable must be boolean',
    );
  }
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AgentPackageCompatibilityError(`${field} must be a non-empty string`);
  }
}

function assertBoundedString(value: unknown, field: string, maxLength: number): asserts value is string {
  assertNonEmptyString(value, field);
  if (value.length > maxLength) {
    throw new AgentPackageCompatibilityError(`${field} exceeds ${maxLength} characters`);
  }
}

function assertTimestamp(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value || !Number.isFinite(Date.parse(value))) {
    throw new AgentPackageCompatibilityError(`${field} must be a valid timestamp`);
  }
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: Iterable<string>,
  field: string,
): void {
  const allowedKeys = allowed instanceof Set ? allowed : new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unexpected) {
    throw new AgentPackageCompatibilityError(`${field} contains unsupported field '${unexpected}'`);
  }
}

function validatePortableRuntime(value: unknown): void {
  if (!isRecord(value)) {
    throw new AgentPackageCompatibilityError('agent.runtime must be an object');
  }
  assertOnlyKeys(value, PORTABLE_RUNTIME_KEYS, 'agent.runtime');
  assertOptionalFiniteNumber(value.temperature, 'agent.runtime.temperature', { min: 0, max: 2 });
  assertOptionalFiniteNumber(value.maxIterations, 'agent.runtime.maxIterations', {
    integer: true,
    min: 0,
  });
  assertOptionalFiniteNumber(value.toolExecutionTimeout, 'agent.runtime.toolExecutionTimeout', {
    integer: true,
    min: 0,
  });

  if (value.historyMode !== undefined
    && value.historyMode !== 'none'
    && value.historyMode !== 'summary'
    && value.historyMode !== 'full') {
    throw new AgentPackageCompatibilityError(
      "agent.runtime.historyMode must be 'none', 'summary', or 'full'",
    );
  }

  if (value.thinking !== undefined) {
    const thinking = assertNestedObject(value.thinking, 'agent.runtime.thinking', [
      'enabled', 'budgetTokens', 'effort',
    ]);
    if (typeof thinking.enabled !== 'boolean') {
      throw new AgentPackageCompatibilityError('agent.runtime.thinking.enabled must be boolean');
    }
    assertOptionalFiniteNumber(
      thinking.budgetTokens,
      'agent.runtime.thinking.budgetTokens',
      { integer: true, min: thinking.enabled ? 1 : 0 },
    );
    const efforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    if (thinking.effort !== undefined
      && (typeof thinking.effort !== 'string' || !efforts.has(thinking.effort))) {
      throw new AgentPackageCompatibilityError('agent.runtime.thinking.effort is unsupported');
    }
  }

  if (value.limits !== undefined) {
    const limits = assertNestedObject(value.limits, 'agent.runtime.limits', [
      'maxExecutionTime', 'maxToolCalls', 'maxContextSize', 'maxInputMessages',
    ]);
    for (const key of [
      'maxExecutionTime', 'maxToolCalls', 'maxContextSize', 'maxInputMessages',
    ] as const) {
      assertOptionalFiniteNumber(limits[key], `agent.runtime.limits.${key}`, {
        integer: true,
        min: 0,
      });
    }
  }

  if (value.errorHandling !== undefined) {
    const handling = assertNestedObject(value.errorHandling, 'agent.runtime.errorHandling', [
      'hookFailureMode', 'toolFailureMode', 'maxConsecutiveErrors',
    ]);
    if (handling.hookFailureMode !== undefined
      && handling.hookFailureMode !== 'fail'
      && handling.hookFailureMode !== 'warn'
      && handling.hookFailureMode !== 'ignore') {
      throw new AgentPackageCompatibilityError(
        "agent.runtime.errorHandling.hookFailureMode must be 'fail', 'warn', or 'ignore'",
      );
    }
    if (handling.toolFailureMode !== undefined
      && handling.toolFailureMode !== 'fail'
      && handling.toolFailureMode !== 'continue') {
      throw new AgentPackageCompatibilityError(
        "agent.runtime.errorHandling.toolFailureMode must be 'fail' or 'continue'",
      );
    }
    assertOptionalFiniteNumber(
      handling.maxConsecutiveErrors,
      'agent.runtime.errorHandling.maxConsecutiveErrors',
      { integer: true, min: 0 },
    );
  }

  if (value.asyncTools !== undefined) {
    const asyncTools = assertNestedObject(value.asyncTools, 'agent.runtime.asyncTools', [
      'autoContinue', 'batchWindowMs', 'asyncTimeout',
    ]);
    if (asyncTools.autoContinue !== undefined && typeof asyncTools.autoContinue !== 'boolean') {
      throw new AgentPackageCompatibilityError(
        'agent.runtime.asyncTools.autoContinue must be boolean',
      );
    }
    assertOptionalFiniteNumber(
      asyncTools.batchWindowMs,
      'agent.runtime.asyncTools.batchWindowMs',
      { integer: true, min: 0 },
    );
    assertOptionalFiniteNumber(
      asyncTools.asyncTimeout,
      'agent.runtime.asyncTools.asyncTimeout',
      { integer: true, min: 0 },
    );
  }

  if (value.emptyResponseRetry !== undefined) {
    const retry = assertNestedObject(
      value.emptyResponseRetry,
      'agent.runtime.emptyResponseRetry',
      ['enabled', 'maxRetries', 'initialDelayMs', 'maxDelayMs'],
    );
    if (retry.enabled !== undefined && typeof retry.enabled !== 'boolean') {
      throw new AgentPackageCompatibilityError(
        'agent.runtime.emptyResponseRetry.enabled must be boolean',
      );
    }
    for (const key of ['maxRetries', 'initialDelayMs', 'maxDelayMs'] as const) {
      assertOptionalFiniteNumber(retry[key], `agent.runtime.emptyResponseRetry.${key}`, {
        integer: true,
        min: 0,
      });
    }
    if (typeof retry.initialDelayMs === 'number'
      && typeof retry.maxDelayMs === 'number'
      && retry.maxDelayMs < retry.initialDelayMs) {
      throw new AgentPackageCompatibilityError(
        'agent.runtime.emptyResponseRetry.maxDelayMs must be at least initialDelayMs',
      );
    }
  }
}

function assertNestedObject(
  value: unknown,
  field: string,
  allowedKeys: string[],
): Record<string, unknown> {
  if (!isRecord(value)) throw new AgentPackageCompatibilityError(`${field} must be an object`);
  assertOnlyKeys(value, allowedKeys, field);
  return value;
}

function assertOptionalFiniteNumber(
  value: unknown,
  field: string,
  options: { integer?: boolean; min?: number; max?: number } = {},
): void {
  if (value === undefined) return;
  if (typeof value !== 'number'
    || !Number.isFinite(value)
    || (options.integer === true && !Number.isInteger(value))
    || (options.min !== undefined && value < options.min)
    || (options.max !== undefined && value > options.max)) {
    const constraints = [
      options.integer ? 'an integer' : 'a finite number',
      options.min !== undefined ? `at least ${options.min}` : '',
      options.max !== undefined ? `at most ${options.max}` : '',
    ].filter(Boolean).join(' and ');
    throw new AgentPackageCompatibilityError(`${field} must be ${constraints}`);
  }
}

function validatePortableContext(value: unknown): void {
  if (!isRecord(value)) throw new AgentPackageCompatibilityError('agent.context must be an object');
  assertOnlyKeys(value, ['features', 'pluginNames', 'state'], 'agent.context');
  if (!isRecord(value.features)) {
    throw new AgentPackageCompatibilityError('agent.context.features must be an object');
  }
  if (Object.keys(value.features).length > MAX_PLUGINS) {
    throw new AgentPackageCompatibilityError(
      `agent.context.features exceeds ${MAX_PLUGINS} entries`,
    );
  }
  for (const featureName of REQUIRED_CONTEXT_FEATURE_KEYS) {
    if (typeof value.features[featureName] !== 'boolean') {
      throw new AgentPackageCompatibilityError(
        `agent.context.features.${featureName} must be boolean`,
      );
    }
  }
  for (const [featureName, enabled] of Object.entries(value.features)) {
    assertBoundedString(
      featureName,
      'agent.context.features key',
      MAX_METADATA_STRING_LENGTH,
    );
    if (typeof enabled !== 'boolean') {
      throw new AgentPackageCompatibilityError(
        `agent.context.features.${featureName} must be boolean`,
      );
    }
  }
  if (!Array.isArray(value.pluginNames) || value.pluginNames.length > MAX_PLUGINS) {
    throw new AgentPackageCompatibilityError(
      `agent.context.pluginNames must be an array of at most ${MAX_PLUGINS} entries`,
    );
  }
  const pluginNames = new Set<string>();
  for (const pluginName of value.pluginNames) {
    assertBoundedString(pluginName, 'agent.context.pluginNames[]', MAX_METADATA_STRING_LENGTH);
    if (pluginNames.has(pluginName)) {
      throw new AgentPackageCompatibilityError(`Duplicate context plugin '${pluginName}'`);
    }
    pluginNames.add(pluginName);
  }
  if (!isRecord(value.state)) {
    throw new AgentPackageCompatibilityError('agent.context.state must be an object');
  }
  const state = value.state;
  assertOnlyKeys(
    state,
    ['conversation', 'pluginStates', 'metadata', 'agentState'],
    'agent.context.state',
  );
  if (!Array.isArray(state.conversation) || state.conversation.length > MAX_CONTEXT_MESSAGES) {
    throw new AgentPackageCompatibilityError(
      `agent.context.state.conversation must be an array of at most ${MAX_CONTEXT_MESSAGES} entries`,
    );
  }
  for (let index = 0; index < state.conversation.length; index++) {
    validatePortableConversationItem(state.conversation[index], index);
  }
  if (!isRecord(state.pluginStates)) {
    throw new AgentPackageCompatibilityError('agent.context.state.pluginStates must be an object');
  }
  if (Object.keys(state.pluginStates).length > MAX_PLUGINS) {
    throw new AgentPackageCompatibilityError(
      `agent.context.state.pluginStates exceeds ${MAX_PLUGINS} entries`,
    );
  }
  if (!isRecord(state.metadata)) {
    throw new AgentPackageCompatibilityError('agent.context.state.metadata must be an object');
  }
  assertOnlyKeys(
    state.metadata,
    ['savedAt', 'agentId', 'userId', 'model'],
    'agent.context.state.metadata',
  );
  if (typeof state.metadata.savedAt !== 'number' || !Number.isFinite(state.metadata.savedAt)) {
    throw new AgentPackageCompatibilityError('agent.context.state.metadata.savedAt must be finite');
  }
  assertBoundedString(
    state.metadata.model,
    'agent.context.state.metadata.model',
    MAX_METADATA_STRING_LENGTH,
  );
  if (state.metadata.agentId !== undefined) {
    assertBoundedString(
      state.metadata.agentId,
      'agent.context.state.metadata.agentId',
      MAX_AGENT_NAME_LENGTH,
    );
  }
  if (state.metadata.userId !== undefined) {
    assertBoundedString(
      state.metadata.userId,
      'agent.context.state.metadata.userId',
      MAX_METADATA_STRING_LENGTH,
    );
  }
  if (state.agentState !== undefined && !isRecord(state.agentState)) {
    throw new AgentPackageCompatibilityError('agent.context.state.agentState must be an object');
  }
}

function validatePortableConversationItem(value: unknown, index: number): void {
  const field = `agent.context.state.conversation[${index}]`;
  if (!isRecord(value)) {
    throw new AgentPackageCompatibilityError(`${field} must be an object`);
  }
  if (value.type === 'compaction') {
    assertOnlyKeys(value, ['type', 'id', 'encrypted_content'], field);
    assertBoundedString(value.id, `${field}.id`, MAX_METADATA_STRING_LENGTH);
    if (typeof value.encrypted_content !== 'string') {
      throw new AgentPackageCompatibilityError(`${field}.encrypted_content must be a string`);
    }
    return;
  }
  if (value.type !== 'message') {
    throw new AgentPackageCompatibilityError(`${field}.type must be 'message' or 'compaction'`);
  }
  assertOnlyKeys(value, ['type', 'id', 'role', 'content'], field);
  if (value.id !== undefined) {
    assertBoundedString(value.id, `${field}.id`, MAX_METADATA_STRING_LENGTH);
  }
  if (value.role !== 'user' && value.role !== 'assistant' && value.role !== 'developer') {
    throw new AgentPackageCompatibilityError(
      `${field}.role must be 'user', 'assistant', or 'developer'`,
    );
  }
  if (!Array.isArray(value.content) || value.content.length > MAX_CONTENT_ITEMS_PER_MESSAGE) {
    throw new AgentPackageCompatibilityError(
      `${field}.content must be an array of at most ${MAX_CONTENT_ITEMS_PER_MESSAGE} entries`,
    );
  }
  for (let contentIndex = 0; contentIndex < value.content.length; contentIndex++) {
    validatePortableContent(value.content[contentIndex], `${field}.content[${contentIndex}]`);
  }
}

function validatePortableContent(value: unknown, field: string): void {
  if (!isRecord(value)) {
    throw new AgentPackageCompatibilityError(`${field} must be an object`);
  }
  const cacheBreakpoint = (): void => {
    if (value.promptCacheBreakpoint !== undefined
      && typeof value.promptCacheBreakpoint !== 'boolean') {
      throw new AgentPackageCompatibilityError(`${field}.promptCacheBreakpoint must be boolean`);
    }
  };
  switch (value.type) {
    case 'input_text':
      assertOnlyKeys(value, ['type', 'text', 'promptCacheBreakpoint'], field);
      if (typeof value.text !== 'string') {
        throw new AgentPackageCompatibilityError(`${field}.text must be a string`);
      }
      break;
    case 'input_image_url': {
      assertOnlyKeys(value, ['type', 'image_url', 'promptCacheBreakpoint'], field);
      if (!isRecord(value.image_url)) {
        throw new AgentPackageCompatibilityError(`${field}.image_url must be an object`);
      }
      assertOnlyKeys(value.image_url, ['url', 'detail'], `${field}.image_url`);
      assertNonEmptyString(value.image_url.url, `${field}.image_url.url`);
      if (value.image_url.detail !== undefined
        && value.image_url.detail !== 'auto'
        && value.image_url.detail !== 'low'
        && value.image_url.detail !== 'high') {
        throw new AgentPackageCompatibilityError(
          `${field}.image_url.detail must be 'auto', 'low', or 'high'`,
        );
      }
      break;
    }
    case 'input_file':
      assertOnlyKeys(value, ['type', 'file_id', 'promptCacheBreakpoint'], field);
      assertBoundedString(value.file_id, `${field}.file_id`, MAX_METADATA_STRING_LENGTH);
      break;
    case 'output_text':
      assertOnlyKeys(value, ['type', 'text', 'annotations', 'promptCacheBreakpoint'], field);
      if (typeof value.text !== 'string') {
        throw new AgentPackageCompatibilityError(`${field}.text must be a string`);
      }
      if (value.annotations !== undefined && !Array.isArray(value.annotations)) {
        throw new AgentPackageCompatibilityError(`${field}.annotations must be an array`);
      }
      break;
    case 'tool_use':
      assertOnlyKeys(
        value,
        ['type', 'id', 'name', 'arguments', 'thoughtSignature', 'promptCacheBreakpoint'],
        field,
      );
      assertBoundedString(value.id, `${field}.id`, MAX_REMOTE_REQUEST_ID_LENGTH);
      assertBoundedString(value.name, `${field}.name`, MAX_REMOTE_TOOL_NAME_LENGTH);
      if (typeof value.arguments !== 'string') {
        throw new AgentPackageCompatibilityError(`${field}.arguments must be a string`);
      }
      if (value.thoughtSignature !== undefined && typeof value.thoughtSignature !== 'string') {
        throw new AgentPackageCompatibilityError(`${field}.thoughtSignature must be a string`);
      }
      break;
    case 'tool_result':
      assertOnlyKeys(
        value,
        ['type', 'tool_use_id', 'content', 'error', '__images', 'promptCacheBreakpoint'],
        field,
      );
      assertBoundedString(
        value.tool_use_id,
        `${field}.tool_use_id`,
        MAX_REMOTE_REQUEST_ID_LENGTH,
      );
      if (!Object.prototype.hasOwnProperty.call(value, 'content')) {
        throw new AgentPackageCompatibilityError(`${field}.content is required`);
      }
      if (value.error !== undefined && typeof value.error !== 'string') {
        throw new AgentPackageCompatibilityError(`${field}.error must be a string`);
      }
      if (value.__images !== undefined) {
        if (!Array.isArray(value.__images)) {
          throw new AgentPackageCompatibilityError(`${field}.__images must be an array`);
        }
        for (let index = 0; index < value.__images.length; index++) {
          const image = value.__images[index];
          if (!isRecord(image)) {
            throw new AgentPackageCompatibilityError(`${field}.__images[${index}] must be an object`);
          }
          assertOnlyKeys(image, ['base64', 'mediaType'], `${field}.__images[${index}]`);
          assertNonEmptyString(image.base64, `${field}.__images[${index}].base64`);
          assertBoundedString(
            image.mediaType,
            `${field}.__images[${index}].mediaType`,
            MAX_METADATA_STRING_LENGTH,
          );
        }
      }
      break;
    case 'thinking':
      assertOnlyKeys(
        value,
        [
          'type',
          'thinking',
          'providerItemId',
          'providerMetadata',
          'signature',
          'persistInHistory',
          'promptCacheBreakpoint',
        ],
        field,
      );
      if (typeof value.thinking !== 'string') {
        throw new AgentPackageCompatibilityError(`${field}.thinking must be a string`);
      }
      for (const key of ['providerItemId', 'signature'] as const) {
        if (value[key] !== undefined && typeof value[key] !== 'string') {
          throw new AgentPackageCompatibilityError(`${field}.${key} must be a string`);
        }
      }
      if (value.providerMetadata !== undefined && !isRecord(value.providerMetadata)) {
        throw new AgentPackageCompatibilityError(`${field}.providerMetadata must be an object`);
      }
      if (typeof value.persistInHistory !== 'boolean') {
        throw new AgentPackageCompatibilityError(`${field}.persistInHistory must be boolean`);
      }
      break;
    default:
      throw new AgentPackageCompatibilityError(`${field}.type is unsupported`);
  }
  cacheBreakpoint();
}

function validatePortableTool(
  value: unknown,
  index: number,
  toolNames: Set<string>,
): void {
  const field = `agent.tools[${index}]`;
  if (!isRecord(value)) throw new AgentPackageCompatibilityError(`${field} must be an object`);
  assertOnlyKeys(value, [
    'definition', 'placement', 'permission', 'implementationFingerprint',
    'namespace', 'category', 'tags',
  ], field);
  if (value.placement !== 'local' && value.placement !== 'remote') {
    throw new AgentPackageCompatibilityError(`${field}.placement must be 'local' or 'remote'`);
  }
  assertBoundedString(
    value.implementationFingerprint,
    `${field}.implementationFingerprint`,
    MAX_METADATA_STRING_LENGTH,
  );
  if (!/^sha256:[a-f0-9]{64}$/.test(value.implementationFingerprint)) {
    throw new AgentPackageCompatibilityError(
      `${field}.implementationFingerprint must be a SHA-256 fingerprint`,
    );
  }
  if (value.permission !== undefined) validatePortableToolPermission(value.permission, field);
  if (!isRecord(value.definition)) {
    throw new AgentPackageCompatibilityError(`${field}.definition must be an object`);
  }
  assertOnlyKeys(value.definition, ['type', 'function', 'blocking', 'timeout'], `${field}.definition`);
  if (value.definition.type !== 'function' || !isRecord(value.definition.function)) {
    throw new AgentPackageCompatibilityError(`${field}.definition must describe a function`);
  }
  assertOnlyKeys(
    value.definition.function,
    ['name', 'description', 'parameters', 'strict'],
    `${field}.definition.function`,
  );
  assertBoundedString(
    value.definition.function.name,
    `${field}.definition.function.name`,
    MAX_REMOTE_TOOL_NAME_LENGTH,
  );
  const toolName = value.definition.function.name;
  if (toolNames.has(toolName)) {
    throw new AgentPackageCompatibilityError(`Duplicate portable tool '${toolName}'`);
  }
  toolNames.add(toolName);
  if (value.definition.function.description !== undefined
    && typeof value.definition.function.description !== 'string') {
    throw new AgentPackageCompatibilityError(`${field}.definition.function.description must be a string`);
  }
  if (value.definition.function.parameters !== undefined
    && !isRecord(value.definition.function.parameters)) {
    throw new AgentPackageCompatibilityError(`${field}.definition.function.parameters must be an object`);
  }
  if (value.definition.function.strict !== undefined
    && typeof value.definition.function.strict !== 'boolean') {
    throw new AgentPackageCompatibilityError(`${field}.definition.function.strict must be boolean`);
  }
  if (value.definition.blocking !== undefined && typeof value.definition.blocking !== 'boolean') {
    throw new AgentPackageCompatibilityError(`${field}.definition.blocking must be boolean`);
  }
  if (value.definition.timeout !== undefined
    && (typeof value.definition.timeout !== 'number' || !Number.isFinite(value.definition.timeout))) {
    throw new AgentPackageCompatibilityError(`${field}.definition.timeout must be finite`);
  }
  for (const key of ['namespace', 'category'] as const) {
    if (value[key] !== undefined) {
      assertBoundedString(value[key], `${field}.${key}`, MAX_METADATA_STRING_LENGTH);
    }
  }
  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags) || value.tags.length > MAX_TAGS_PER_TOOL) {
      throw new AgentPackageCompatibilityError(
        `${field}.tags must be an array of at most ${MAX_TAGS_PER_TOOL} entries`,
      );
    }
    for (const tag of value.tags) {
      assertBoundedString(tag, `${field}.tags[]`, MAX_METADATA_STRING_LENGTH);
    }
  }
  if (value.placement === 'remote') {
    const expectedFingerprint = createPortableToolDefinitionFingerprint(
      value.definition as unknown as PortableToolDescriptor['definition'],
    );
    if (value.implementationFingerprint !== expectedFingerprint) {
      throw new AgentPackageCompatibilityError(
        `${field}.implementationFingerprint does not match its remote tool definition`,
      );
    }
  }
}

function validatePortableToolPermission(value: unknown, toolField: string): void {
  const field = `${toolField}.permission`;
  if (!isRecord(value)) throw new AgentPackageCompatibilityError(`${field} must be an object`);
  assertOnlyKeys(
    value,
    ['scope', 'riskLevel', 'approvalMessage', 'sensitiveArgs', 'sessionTTLMs'],
    field,
  );
  if (value.scope !== undefined
    && value.scope !== 'once'
    && value.scope !== 'session'
    && value.scope !== 'always'
    && value.scope !== 'never') {
    throw new AgentPackageCompatibilityError(`${field}.scope is unsupported`);
  }
  if (value.riskLevel !== undefined
    && value.riskLevel !== 'low'
    && value.riskLevel !== 'medium'
    && value.riskLevel !== 'high'
    && value.riskLevel !== 'critical') {
    throw new AgentPackageCompatibilityError(`${field}.riskLevel is unsupported`);
  }
  if (value.approvalMessage !== undefined) {
    assertBoundedString(
      value.approvalMessage,
      `${field}.approvalMessage`,
      MAX_METADATA_STRING_LENGTH,
    );
  }
  if (value.sensitiveArgs !== undefined) {
    if (!Array.isArray(value.sensitiveArgs) || value.sensitiveArgs.length > MAX_TAGS_PER_TOOL) {
      throw new AgentPackageCompatibilityError(
        `${field}.sensitiveArgs must be an array of at most ${MAX_TAGS_PER_TOOL} entries`,
      );
    }
    for (const arg of value.sensitiveArgs) {
      assertBoundedString(arg, `${field}.sensitiveArgs[]`, MAX_METADATA_STRING_LENGTH);
    }
  }
  assertOptionalFiniteNumber(value.sessionTTLMs, `${field}.sessionTTLMs`, {
    integer: true,
    min: 1,
  });
}

function validateRealtimeProfile(value: unknown): void {
  if (!isRecord(value)) throw new AgentPackageCompatibilityError('agent.realtime must be an object');
  assertOnlyKeys(
    value,
    ['provider', 'connectorName', 'model', 'voice'],
    'agent.realtime',
  );
  for (const key of ['provider', 'connectorName', 'model'] as const) {
    assertBoundedString(value[key], `agent.realtime.${key}`, MAX_METADATA_STRING_LENGTH);
  }
  if (value.voice !== undefined) {
    assertBoundedString(value.voice, 'agent.realtime.voice', MAX_METADATA_STRING_LENGTH);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertJsonValue(
  value: unknown,
  field: string,
  depth = 0,
  ancestors: WeakSet<object> = new WeakSet(),
): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw new AgentPackageCompatibilityError(`${field} contains a non-finite number`);
  }
  if (depth > 100) {
    throw new AgentPackageCompatibilityError(`${field} exceeds the maximum JSON nesting depth`);
  }
  if (typeof value !== 'object') {
    throw new AgentPackageCompatibilityError(`${field} contains a non-JSON value`);
  }
  if (ancestors.has(value)) {
    throw new AgentPackageCompatibilityError(`${field} contains a circular reference`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        assertJsonValue(value[index], `${field}[${index}]`, depth + 1, ancestors);
      }
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new AgentPackageCompatibilityError(`${field} contains a non-JSON object`);
    }
    for (const [key, entry] of Object.entries(value)) {
      assertJsonValue(entry, `${field}.${key}`, depth + 1, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertJsonByteLimit(value: unknown, field: string, maxBytes: number): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new AgentPackageCompatibilityError(
      `${field} must be JSON-serializable: ${errorMessage(error)}`,
    );
  }
  if (serialized === undefined) {
    throw new AgentPackageCompatibilityError(`${field} contains a non-JSON value`);
  }
  if (utf8ByteLength(serialized) > maxBytes) {
    throw new AgentPackageCompatibilityError(`${field} exceeds ${maxBytes} bytes`);
  }
  return serialized;
}

function cloneBoundedJson<T>(value: T, field: string, maxBytes: number): T {
  assertJsonValue(value, field);
  return JSON.parse(assertJsonByteLimit(value, field, maxBytes)) as T;
}

function isNormalizedToolFailure(value: unknown): boolean {
  return isRecord(value) && value.success === false;
}

function remoteRequestFingerprint(request: RemoteToolExecutionRequest): string {
  return `${request.toolName}:${stableJson(request.arguments)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${stableJson(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Canonicalize with JSON wire semantics before sorting object keys. */
function stableWireJson(value: unknown): string {
  return stableJson(cloneJson(value));
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch (error) {
    throw new TypeError(`Agent package values must be JSON-serializable: ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
