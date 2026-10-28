/**
 * Compile-only design prototype. These declarations are PROPOSALS, not package
 * exports or implementations. Never run this file. It validates new contract
 * coherence against the existing built public package, including negative cases.
 */
import type {
  Connector, ModelTask,
  OrchestratorConfig, RoutineDefinition, 
  ToolFunction, RunOptions, DirectCallOptions,
} from '@everworker/oneringai';
import { Agent, AGENT_PACKAGE_PROTOCOL_VERSION, createOutcomeTool } from '@everworker/oneringai';

// C1–C3 use delivered root exports; later declarations remain proposals.
export type { OutcomeInvocation, OutcomeToolOptions } from '@everworker/oneringai';
import { createRoutineRunner } from '@everworker/oneringai';
import type { ExecutionBinding, RoutineContinuation, RoutineObservation, RoutineToolResult } from '@everworker/oneringai';
export type { ExecutionBinding, VerificationDecision, VerificationContext, RoutineSource,
  RoutineObservation, RoutineContinuation, RoutineReport, RoutineRunResult, RoutineRunRequest,
  RoutineToolOptions, RoutineToolResult, RoutineInspection, RoutineRunner, RoutineProgress } from '@everworker/oneringai';

import { ConnectorTools } from '@everworker/oneringai';
import type { EnhancedConnectorOptions, PagePosition } from '@everworker/oneringai';
export type { EnhancedConnectorOptions, EnhancedConnectorAttempt, ConnectorAcceptedResource } from '@everworker/oneringai';
export function enhancedConnectorTools(connector: string | Connector, options: EnhancedConnectorOptions): ToolFunction[] {
  return ConnectorTools.enhanced(connector, options);
}

export type { PagePosition, ConnectorPage } from '@everworker/oneringai';

/** Minimal static registration recipe; never executed, no catalog/profile bypass. */
export function staticConnectorExample(llmConnector: string, model: string, service: string, accountId: string): Agent {
  const selected = enhancedConnectorTools(service, { profile: 'execution-v1', accountId });
  if (!selected.length) throw new Error('Selected profile has no tools');
  const agent = Agent.create({
    connector: llmConnector, model,
    identities: [{ connector: service, accountId,
      toolFilter: selected.map(tool => tool.definition.function.name) }],
    context: { model, features: { toolCatalog: false } },
  });
  agent.tools.registerConnectorTools(service, selected, { accountId });
  return agent; // Caller destroys this Agent; no construction call occurs in this file.
}

import { createOrchestratorWithFactory } from '@everworker/oneringai';
import type { OrchestratedAgentConfig, AgentConstructionRequest } from '@everworker/oneringai';
export type { OrchestratedAgentConfig, AgentConstructionRequest, ChildObservation, OrchestratorFactoryOptions } from '@everworker/oneringai';

/** Positive and negative compile controls; none of these functions are executed. */
export async function example(agent: Agent, definition: RoutineDefinition, task: ModelTask): Promise<void> {
  const tool = createOutcomeTool({
    definition: { type: 'function', function: { name: 'proposed_lookup', parameters: { type: 'object', properties: {} } } },
    execute: async (_args: Record<string, unknown>, invocation) => {
      invocation.reportFailure(new Error('Synthetic operational failure'));
      return { success: false, record: null };
    },
  });
  const ordinary: ToolFunction = tool;
  agent.tools.register(ordinary);
  const runner = createRoutineRunner({
    verify: async (observation, context) => {
      const binding: Readonly<ExecutionBinding> = context.execution;
      void binding;
      return observation.phase === 'task'
        ? { kind: 'verified' }
        : { kind: 'waiting', reason: 'Synthetic provider acceptance is not completion' };
    },
  });
  try {
    const result = await runner.run({ definition, agent, execution: { modelTask: task } });
    if (result.state === 'waiting' || result.state === 'blocked' || result.state === 'uncertain') {
      await runner.resume(result.continuation, { authorize: () => true, execution: { modelTask: task } });
    } else if (result.state === 'completed') {
      const verdict: 'verified' = result.verification.kind;
      void verdict;
      // @ts-expect-error Terminal completion does not contain a resume capability.
      void result.continuation;
    }
  } finally { runner.close(); }

  // @ts-expect-error Host verification is required; no silent legacy mode.
  createRoutineRunner({});
  // @ts-expect-error Plain serialized data cannot manufacture a live continuation.
  await runner.resume({}, { authorize: () => true });
  // @ts-expect-error Renewed host authorization is required to resume.
  await runner.resume({} as RoutineContinuation, {});
  // @ts-expect-error Unsupported public run signal must not be assumed.
  const unsupported: RunOptions = { signal: new AbortController().signal };
  void unsupported;
  const supportedDirect: DirectCallOptions = { signal: new AbortController().signal, modelTask: task };
  void supportedDirect;
  const legacyLiteral: 2 = AGENT_PACKAGE_PROTOCOL_VERSION;
  void legacyLiteral;
  // @ts-expect-error New pagination cannot claim more pages without continuation.
  const missingCursor: PagePosition = { state: 'more' };
  void missingCursor;
  // @ts-expect-error A whole-routine observation cannot masquerade as one task.
  const wrongPhase: RoutineObservation = { operationId: 'r', phase: 'routine', reason: 'settled', taskId: 't', tasks: [], toolOutcomes: [], stepOutcomes: [] };
  void wrongPhase;
  // @ts-expect-error Routine model-side results must not expose a host capability.
  const leaked: RoutineToolResult = { operationId: 'r', state: 'waiting', references: [], continuation: {} };
  void leaked;
}

/** Compile-only configuration forwarding; library constructs the Agent afterward. */
export async function orchestrationExample(config: OrchestratorConfig, legacy: Agent): Promise<Agent> {
  const parent = await createOrchestratorWithFactory(config, {
    configureAgent: async ({ role, baseline }) => ({
      ...baseline,
      model: role === 'parent' ? config.model : 'host-selected-worker-model',
      temperature: 0,
      toolExecutionTimeout: 0,
      historyMode: 'full',
      asyncTools: { autoContinue: false },
      context: {
        model: role === 'parent' ? config.model : 'host-selected-worker-model',
        responseReserve: 0,
        strategy: 'algorithmic',
        features: { workingMemory: false, inContextMemory: false },
      },
    }),
  });
  // @ts-expect-error A built Agent cannot guarantee pre-initialization composition.
  await createOrchestratorWithFactory(config, { configureAgent: () => legacy });
  // @ts-expect-error Live contexts are excluded only on this proposed new path.
  const liveContext: OrchestratedAgentConfig = { connector: config.connector, model: config.model, context: legacy.context };
  void liveContext;
  // @ts-expect-error Hierarchy names are allocated by the orchestrator.
  const hierarchyOverride: OrchestratedAgentConfig = { connector: config.connector, model: config.model, parentAgentId: 'foreign-parent' };
  void hierarchyOverride;
  // @ts-expect-error The library owns one tool pipeline on this new path.
  const sharedManager: OrchestratedAgentConfig = { connector: config.connector, model: config.model, toolManager: legacy.tools };
  void sharedManager;
  const forbiddenVariable = { connector: config.connector, model: config.model,
    toolManager: legacy.tools, parentAgentId: 'foreign', name: 'foreign' };
  // @ts-expect-error Forbidden keys are rejected for variables, not just fresh literals.
  await createOrchestratorWithFactory(config, { configureAgent: () => forbiddenVariable });
  // @ts-expect-error Worker config requests must identify their authorized type.
  const missingWorkerType: AgentConstructionRequest = { role: 'worker', name: 'worker', baseline: { connector: config.connector, model: config.model } };
  void missingWorkerType;
  return parent;
}
