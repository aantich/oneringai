import { boundedData, freezeData } from './routines/observations.js';
import { ROUTINE_KEYS } from './routineKeys.js';
/**
 * Routine Execution Runner
 *
 * Executes a RoutineDefinition by creating an Agent, running tasks in dependency order,
 * validating completion via LLM self-reflection, and using working/in-context memory
 * as the bridge between tasks.
 */

import { Agent } from './Agent.js';
import { bindRoutineExecution, routineBinding, type RoutineBinding } from './execution/routineBinding.js';
import type { ToolFunction } from '../domain/entities/Tool.js';
import type {
  Task,
  TaskValidationResult,
  TaskMapFlow,
  TaskFoldFlow,
} from '../domain/entities/Task.js';
import {
  getNextExecutableTasks,
  updateTaskStatus,
  isTerminalStatus,
} from '../domain/entities/Task.js';
import type {
  RoutineDefinition,
  RoutineExecution,
  DeterministicStep,
} from '../domain/entities/Routine.js';
import {
  createRoutineExecution,
  getRoutineProgress,
} from '../domain/entities/Routine.js';
import { ContentType } from '../domain/entities/Content.js';
import type { Content } from '../domain/entities/Content.js';
import type { InputItem, Message } from '../domain/entities/Message.js';
import type { HookConfig } from '../capabilities/agents/types/HookTypes.js';
import { extractJSON } from '../utils/jsonExtractor.js';
import { logger } from '../infrastructure/observability/Logger.js';
import {
  InvalidConfigError,
  ModelNotSupportedError,
  ProviderAuthError,
  ProviderContextLengthError,
  ProviderMisalignmentError,
  ProviderNotFoundError,
} from '../domain/errors/AIErrors.js';
import {
  validateAndResolveInputs,
  resolveTaskTemplates,
  executeControlFlow,
  resolveStepArgs,
  storeResult,
  withTimeout,
  getPlugins,
  readMemoryValue,
} from './routineControlFlow.js';
import type { StepResolveContext } from './routineControlFlow.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Lifecycle hook names the runner registers on the executor agent for the
 * duration of a routine execution. Listed once here to keep the scoped and
 * non-scoped Mode 2 branches in sync.
 */
const ROUTINE_HOOK_NAMES = [
  'before:execution', 'after:execution', 'before:llm', 'after:llm',
  'before:tool', 'after:tool', 'approve:tool', 'pause:check',
] as const;

// ============================================================================
// Types
// ============================================================================

/**
 * Options for executing a routine.
 *
 * Two modes:
 * 1. **New agent**: Pass `connector` + `model` (+ optional `tools`, `hooks`).
 *    An agent is created internally and destroyed after execution.
 * 2. **Existing agent**: Pass `agent` (a pre-created Agent instance).
 *    The agent is NOT destroyed after execution — caller owns its lifecycle.
 *    The agent's existing connector, model, tools, and hooks are used.
 *
 * **Tool scoping (Mode 2 + `definition.requiredTools`)**: when the caller
 * passes an `agent` AND the routine declares `requiredTools`, the runner
 * builds a scoped executor via `existingAgent.scopedTo(requiredTools)` and
 * runs the routine on that. The caller's superagent stays untouched; the
 * scoped executor is destroyed at end of run. The scoped executor uses
 * default context features (working memory, in-context memory) and does NOT
 * inherit the caller's plugins — routines that need plugins must declare
 * them in `requiredPlugins`.
 */
export interface ExecuteRoutineOptions {
  /** Routine definition to execute */
  definition: RoutineDefinition;

  /**
   * Pre-created Agent instance. When provided, `connector`/`model`/`tools` are ignored.
   * The agent is NOT destroyed after execution — caller manages its lifecycle.
   */
  agent?: Agent;

  /** Connector name — required when `agent` is not provided */
  connector?: string;

  /** Model ID — required when `agent` is not provided */
  model?: string;

  /** Additional tools — only used when creating a new agent (no `agent` provided) */
  tools?: ToolFunction[];

  /** Input parameter values for parameterized routines */
  inputs?: Record<string, unknown>;

  /**
   * When `true`, skip the `scopedTo(requiredTools)` step in Mode 2.
   * The agent keeps its full tool surface during the routine, so preSteps /
   * postSteps may use any tool registered on the agent — not only those
   * listed in `definition.requiredTools`.
   *
   * `requiredTools` is still validated as a "must be present" gate; this
   * flag only disables the *restriction* of the agent's runtime toolset.
   *
   * Use when the routine's preSteps invoke tools the LLM tasks don't need,
   * and listing every such tool in `requiredTools` would be misleading
   * (e.g. internal context-loading tools the LLM should not see directly).
   *
   * Defaults to `false` — scoping ON is the safer default.
   */
  disableToolScoping?: boolean;

  /**
   * Optional verbatim user message used in place of the FIRST executable
   * task's prompt. Subsequent tasks still go through the normal
   * `prompts.task` (or default) builder.
   *
   * Use for caller-driven kickoff — e.g. "execute the selected action" — where
   * the routine's first step shouldn't follow the routine's own templating.
   * Retries of the first task re-use this message; only when the routine
   * advances to the next task does the default builder kick in.
   *
   * For pre-loading context into the system prompt, callers should bake it
   * into `agent.instructions` themselves at agent-creation time (Mode 2) or
   * into `prompts.system` (Mode 1) — the library does not own that surface.
   */
  initialUserMessage?: string;

  /** Hooks — applied to agent for the duration of routine execution.
   *  For new agents: baked in at creation. For existing agents: registered before
   *  execution and unregistered after. */
  hooks?: HookConfig;

  /** Called when a task starts executing (set to in_progress) */
  onTaskStarted?: (task: Task, execution: RoutineExecution) => void;

  /** Called when a task completes successfully */
  onTaskComplete?: (task: Task, execution: RoutineExecution) => void;

  /** Called when a task fails */
  onTaskFailed?: (task: Task, execution: RoutineExecution) => void;

  /** Called after each validation attempt (whether pass or fail) */
  onTaskValidation?: (task: Task, result: TaskValidationResult, execution: RoutineExecution) => void;

  /** Called when a deterministic step starts executing */
  onStepStarted?: (step: DeterministicStep, phase: 'pre' | 'post', index: number, execution: RoutineExecution) => void;

  /** Called when a deterministic step completes successfully */
  onStepComplete?: (step: DeterministicStep, phase: 'pre' | 'post', index: number, result: unknown, execution: RoutineExecution) => void;

  /** Called when a deterministic step fails */
  onStepFailed?: (step: DeterministicStep, phase: 'pre' | 'post', index: number, error: Error, execution: RoutineExecution) => void;

  /** Configurable prompts (all have sensible defaults) */
  prompts?: {
    /** Override system prompt builder. Receives definition, should return full system prompt. */
    system?: (definition: RoutineDefinition) => string;
    /** Override task prompt builder. Receives task and optional execution context, should return the user message for that task. */
    task?: (task: Task, execution?: RoutineExecution) => string;
    /** Override validation prompt builder. Receives task + validation context (response, memory state, tool calls). */
    validation?: (task: Task, context: ValidationContext) => string;
  };
}

/**
 * Context snapshot passed to the validation prompt builder.
 * Contains everything the validator needs to evaluate task completion
 * WITHOUT conversation history.
 */
export interface ValidationContext {
  /** Agent's final text output */
  responseText: string;
  /** Current in-context memory entries (key-value pairs set via context_set) */
  inContextMemory: string | null;
  /** Current working memory index (keys + descriptions of stored data) */
  workingMemoryIndex: string | null;
  /** Formatted log of all tool calls made during this task execution */
  toolCallLog: string;
}

// ============================================================================
// Default Prompt Builders
// ============================================================================

/**
 * Default system prompt for routine execution.
 */
function defaultSystemPrompt(definition: RoutineDefinition): string {
  const parts: string[] = [];

  if (definition.instructions) {
    parts.push(definition.instructions);
  }

  parts.push(
    `You are executing a routine called "${definition.name}".`,
    '',
    'Between tasks, your conversation history is cleared but your memory persists.',
    'Use these strategies to pass information between tasks:',
    '- Use context_set for small key results that subsequent tasks need immediately (visible in context, no retrieval needed).',
    '- Use memory_store with tier="findings" for larger data that may be needed later.',
    '- Use memory_retrieve to access data stored by previous tasks.',
    '',
    'IMPORTANT: When you have completed the current task, you MUST stop immediately.',
    'Do NOT repeat work you have already done. Do NOT re-fetch data you already have.',
    'Store key results in memory once, then produce a final text response (no more tool calls) to signal completion.'
  );

  return parts.join('\n');
}

/** Describes what a downstream control flow task needs from the current task's output. */
interface OutputContract {
  storageKey: string;
  format: 'array';
  consumingTaskName: string;
  flowType: 'map' | 'fold';
}

/**
 * Scan the execution plan for downstream control flow tasks that reference
 * the current task via source.task. Returns output storage contracts.
 */
function getOutputContracts(
  execution: RoutineExecution,
  currentTask: Task
): OutputContract[] {
  const contracts: OutputContract[] = [];

  for (const task of execution.plan.tasks) {
    if (task.status !== 'pending' || !task.controlFlow) continue;
    const flow = task.controlFlow;
    if (flow.type === 'until') continue;

    const source = (flow as TaskMapFlow | TaskFoldFlow).source;

    const sourceTaskName = typeof source === 'string'
      ? undefined  // string source = key reference, not task reference
      : source.task;

    if (sourceTaskName === currentTask.name) {
      contracts.push({
        storageKey: `${ROUTINE_KEYS.TASK_OUTPUT_PREFIX}${currentTask.name}`,
        format: 'array',
        consumingTaskName: task.name,
        flowType: flow.type as 'map' | 'fold',
      });
    }
  }

  return contracts;
}

/**
 * Default task prompt builder.
 */
function defaultTaskPrompt(task: Task, execution?: RoutineExecution): string {
  const parts: string[] = [];

  parts.push(`## Current Task: ${task.name}`, '');
  parts.push(task.description, '');

  if (task.expectedOutput) {
    parts.push(`**Expected output:** ${task.expectedOutput}`, '');
  }

  if (task.suggestedTools && task.suggestedTools.length > 0) {
    parts.push(`**Suggested tools:** ${task.suggestedTools.join(', ')}`, '');
  }

  const criteria = task.validation?.completionCriteria;
  if (criteria && criteria.length > 0) {
    parts.push('### Completion Criteria');
    parts.push('When you are done, ensure the following are met:');
    for (const c of criteria) {
      parts.push(`- ${c}`);
    }
    parts.push('');
  }

  if (task.dependsOn.length > 0) {
    parts.push('Note: Results from prerequisite tasks are available in your live context.');
    parts.push('Small results appear directly; larger results are in working memory — use memory_retrieve to access them.');
    parts.push('Review the plan overview and dependency results before starting.');
    parts.push('');
  }

  // Output contract injection — tell the LLM how to store results for downstream control flow
  if (execution) {
    const contracts = getOutputContracts(execution, task);
    if (contracts.length > 0) {
      parts.push('### Output Storage');
      for (const contract of contracts) {
        parts.push(
          `A downstream task ("${contract.consumingTaskName}") will ${contract.flowType} over your results.`,
          `Store your result as a JSON ${contract.format} using:`,
          `  context_set("${contract.storageKey}", <your JSON ${contract.format}>)`,
          'Each array element should represent one item to process independently.',
          ''
        );
      }
    }
  }

  parts.push('After completing the work, store key results in memory once, then respond with a text summary (no more tool calls).');

  return parts.join('\n');
}

/**
 * Default validation prompt builder.
 * Receives the full validation context: response text, memory state, and tool call log.
 */
function defaultValidationPrompt(task: Task, context: ValidationContext): string {
  const criteria = task.validation?.completionCriteria ?? [];
  const criteriaList = criteria.length > 0
    ? criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
    : 'The task was completed as described.';

  const parts: string[] = [
    `Evaluate if the task "${task.name}" was completed successfully.`,
    '',
    `Task description: ${task.description}`,
    '',
    'Completion criteria:',
    criteriaList,
    '',
    '--- EVIDENCE ---',
    '',
    'Agent response (final text output):',
    context.responseText || '(no text output)',
    '',
    'Tool calls made during this task:',
    context.toolCallLog,
  ];

  if (context.inContextMemory) {
    parts.push('', 'In-context memory (current state):', context.inContextMemory);
  }

  if (context.workingMemoryIndex) {
    parts.push('', 'Working memory index (stored data):', context.workingMemoryIndex);
  }

  parts.push(
    '',
    '--- END EVIDENCE ---',
    '',
    'Use the evidence above to verify each criterion. Check tool call results, not just the agent\'s claims.',
    '',
    'Return a JSON object with the following structure:',
    '```json',
    '{ "isComplete": boolean, "completionScore": number (0-100), "explanation": "..." }',
    '```',
    '',
    'Be strict: only mark isComplete=true if all criteria are clearly met based on the evidence.',
  );

  return parts.join('\n');
}

// ============================================================================
// Context Collection
// ============================================================================

/**
 * Extract a formatted tool call log from the conversation history.
 * Shows every tool_use → tool_result pair so the validator can see what actually happened.
 */
function formatToolCallLog(conversation: ReadonlyArray<InputItem>): string {
  const calls: string[] = [];

  for (const item of conversation) {
    if (!('content' in item) || !Array.isArray((item as Message).content)) continue;
    const msg = item as Message;
    for (const c of msg.content as Content[]) {
      if (c.type === ContentType.TOOL_USE) {
        let argsStr: string;
        try {
          const parsed = JSON.parse(c.arguments);
          argsStr = JSON.stringify(parsed, null, 2);
        } catch {
          argsStr = c.arguments;
        }
        calls.push(`CALL: ${c.name}(${argsStr})`);
      } else if (c.type === ContentType.TOOL_RESULT) {
        const resultStr = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
        const prefix = c.error ? 'ERROR' : 'RESULT';
        calls.push(`  ${prefix}: ${resultStr}`);
      }
    }
  }

  return calls.length > 0 ? calls.join('\n') : '(no tool calls)';
}

/**
 * Collect all context the validator needs: memory state + tool call log.
 */
async function collectValidationContext(
  agent: Agent,
  responseText: string
): Promise<ValidationContext> {
  // Get in-context memory state
  const icmPlugin = agent.context.getPlugin('in_context_memory');
  const inContextMemory = icmPlugin ? await icmPlugin.getContent() : null;

  // Get working memory index
  const wmPlugin = agent.context.memory;
  const workingMemoryIndex = wmPlugin ? await wmPlugin.getContent() : null;

  // Get tool call log from conversation history
  const conversation = agent.context.getConversation();
  const toolCallLog = formatToolCallLog(conversation);

  return {
    responseText,
    inContextMemory,
    workingMemoryIndex,
    toolCallLog,
  };
}

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Determine if an error is transient (worth retrying) or permanent (should fail immediately).
 * Unknown errors default to transient — safer to retry than to give up prematurely.
 */
function isTransientError(error: unknown): boolean {
  // Permanent errors: configuration, auth, or model issues that won't resolve on retry
  if (error instanceof ProviderAuthError) return false;
  if (error instanceof ProviderContextLengthError) return false;
  if (error instanceof ProviderNotFoundError) return false;
  if (error instanceof ProviderMisalignmentError) return false;
  if (error instanceof ModelNotSupportedError) return false;
  if (error instanceof InvalidConfigError) return false;
  // Everything else (rate limits, timeouts, network errors, etc.) — retry
  return true;
}

// ============================================================================
// Routine Context Injection
// ============================================================================

/**
 * Simple token estimator: ~4 chars per token.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build a compact plan overview showing all tasks with statuses and dependencies.
 */
function buildPlanOverview(execution: RoutineExecution, definition: RoutineDefinition, currentTaskId?: string): string {
  const parts: string[] = [];
  const progress = execution.progress ?? 0;

  parts.push(`Routine: ${definition.name}`);
  if (definition.description) {
    parts.push(`Goal: ${definition.description}`);
  }
  parts.push(`Progress: ${Math.round(progress * 100)}%`);
  parts.push('');
  parts.push('Tasks:');

  for (const task of execution.plan.tasks) {
    let statusIcon: string;
    switch (task.status) {
      case 'completed': statusIcon = '[x]'; break;
      case 'in_progress': statusIcon = '[>]'; break;
      case 'failed': statusIcon = '[!]'; break;
      case 'skipped': statusIcon = '[-]'; break;
      default: statusIcon = '[ ]';
    }

    let line = `${statusIcon} ${task.name}`;

    if (task.dependsOn.length > 0) {
      const depNames = task.dependsOn
        .map((depId) => execution.plan.tasks.find((t) => t.id === depId)?.name ?? depId)
        .join(', ');
      line += ` (after: ${depNames})`;
    }

    if (task.id === currentTaskId) {
      line += '  ← CURRENT';
    }

    parts.push(line);
  }

  return parts.join('\n');
}

/**
 * Delete ICM/WM entries matching given prefix lists.
 * Shared by injectRoutineContext (dep cleanup) and cleanupRoutineContext (full cleanup).
 */
async function cleanupMemoryKeys(
  icmPlugin: ReturnType<typeof getPlugins>['icmPlugin'],
  wmPlugin: ReturnType<typeof getPlugins>['wmPlugin'],
  config: {
    icmPrefixes: string[];
    icmExactKeys?: string[];
    wmPrefixes: string[];
  }
): Promise<void> {
  if (icmPlugin) {
    for (const entry of icmPlugin.list()) {
      const shouldDelete =
        config.icmPrefixes.some((p) => entry.key.startsWith(p)) ||
        (config.icmExactKeys?.includes(entry.key) ?? false);
      if (shouldDelete) icmPlugin.delete(entry.key);
    }
  }

  if (wmPlugin) {
    const { entries: wmEntries } = await wmPlugin.query();
    for (const entry of wmEntries) {
      if (config.wmPrefixes.some((p) => entry.key.startsWith(p))) {
        await wmPlugin.delete(entry.key);
      }
    }
  }
}

/** Prefixes for dependency-only cleanup (between tasks). */
const DEP_CLEANUP_CONFIG = {
  icmPrefixes: [ROUTINE_KEYS.DEP_RESULT_PREFIX],
  icmExactKeys: [ROUTINE_KEYS.DEPS],
  wmPrefixes: [ROUTINE_KEYS.DEP_RESULT_PREFIX, ROUTINE_KEYS.WM_DEP_FINDINGS_PREFIX],
};

/** Prefixes for full routine cleanup (after execution). */
const FULL_CLEANUP_CONFIG = {
  icmPrefixes: [
    '__routine_', ROUTINE_KEYS.DEP_RESULT_PREFIX, '__map_', '__fold_',
    ROUTINE_KEYS.TASK_OUTPUT_PREFIX, ROUTINE_KEYS.PRE_STEP_PREFIX, ROUTINE_KEYS.POST_STEP_PREFIX,
  ],
  wmPrefixes: [
    ROUTINE_KEYS.DEP_RESULT_PREFIX, ROUTINE_KEYS.WM_DEP_FINDINGS_PREFIX,
    ROUTINE_KEYS.TASK_OUTPUT_PREFIX, ROUTINE_KEYS.PRE_STEP_PREFIX, ROUTINE_KEYS.POST_STEP_PREFIX,
  ],
};

/**
 * Inject routine context (plan overview + dependency results) into ICM/WM
 * before each task runs.
 *
 * Strategy:
 * - Plan overview → ICM as __routine_plan (high priority)
 * - Small dep results (< 5000 tokens) → ICM as __dep_result_{depId}
 * - Large dep results (>= 5000 tokens) → WM as __dep_result_{depId}
 * - Dependency summary note → ICM as __routine_deps
 */
async function injectRoutineContext(
  agent: Agent,
  execution: RoutineExecution,
  definition: RoutineDefinition,
  currentTask: Task
): Promise<void> {
  const { icmPlugin, wmPlugin } = getPlugins(agent);

  if (!icmPlugin && !wmPlugin) {
    logger.warn('injectRoutineContext: No ICM or WM plugin available — skipping context injection');
    return;
  }

  // 1. Inject plan overview into ICM
  const planOverview = buildPlanOverview(execution, definition, currentTask.id);
  if (icmPlugin) {
    icmPlugin.set(ROUTINE_KEYS.PLAN, 'Routine plan overview with task statuses', planOverview, 'high');
  }

  // 2. Clean up previous task's dependency keys
  await cleanupMemoryKeys(icmPlugin, wmPlugin, DEP_CLEANUP_CONFIG);

  // 3. Inject dependency results
  if (currentTask.dependsOn.length === 0) return;

  const inContextDeps: string[] = [];
  const workingMemoryDeps: string[] = [];

  for (const depId of currentTask.dependsOn) {
    const depTask = execution.plan.tasks.find((t) => t.id === depId);
    if (!depTask?.result) continue;
    if (routineBinding(execution)?.verified ? !('output' in depTask.result) : !depTask.result.output) continue;

    const output = typeof depTask.result.output === 'string'
      ? depTask.result.output
      : JSON.stringify(depTask.result.output);

    const tokens = estimateTokens(output);
    const depKey = `${ROUTINE_KEYS.DEP_RESULT_PREFIX}${depId}`;
    const depLabel = `Result from task "${depTask.name}"`;

    if (tokens < 5000 && icmPlugin) {
      // Small result → ICM (directly in context)
      icmPlugin.set(depKey, depLabel, output, 'high');
      inContextDeps.push(depTask.name);
    } else if (wmPlugin) {
      // Large result → WM (accessible via memory_retrieve)
      await wmPlugin.store(depKey, depLabel, output, { tier: 'findings' });
      workingMemoryDeps.push(depTask.name);
    } else if (icmPlugin) {
      // No WM available — store full output in ICM. ICM's own eviction policy
      // (priority-based, configurable) handles overflow; silent truncation
      // here was dropping tail content the next task needed. Large dependency
      // results ideally go through WM (branch above); hosts that care about
      // ICM size should enable WM. See feedback_no_truncation.md.
      icmPlugin.set(depKey, depLabel, output, 'high');
      inContextDeps.push(depTask.name);
    }
  }

  // 4. Inject dependency summary note
  if (icmPlugin && (inContextDeps.length > 0 || workingMemoryDeps.length > 0)) {
    const summaryParts: string[] = ['Dependency results available:'];
    if (inContextDeps.length > 0) {
      summaryParts.push(`In context (visible now): ${inContextDeps.join(', ')}`);
    }
    if (workingMemoryDeps.length > 0) {
      summaryParts.push(`In working memory (use memory_retrieve): ${workingMemoryDeps.join(', ')}`);
    }
    icmPlugin.set(ROUTINE_KEYS.DEPS, 'Dependency results location guide', summaryParts.join('\n'), 'high');
  }
}

/**
 * Clean up all routine-managed keys from ICM and WM.
 * @param extraKeys — additional exact keys to clean up (e.g., custom resultKeys from deterministic steps)
 */
async function cleanupRoutineContext(agent: Agent, extraKeys?: string[]): Promise<void> {
  const { icmPlugin, wmPlugin } = getPlugins(agent);
  await cleanupMemoryKeys(icmPlugin, wmPlugin, FULL_CLEANUP_CONFIG);

  // Clean up custom resultKeys that don't match standard prefixes
  if (extraKeys && extraKeys.length > 0) {
    for (const key of extraKeys) {
      if (icmPlugin) icmPlugin.delete(key);
      if (wmPlugin) {
        try { await wmPlugin.delete(key); } catch { /* may not exist in WM */ }
      }
    }
  }
}

// ============================================================================
// Validation Helper
// ============================================================================

/**
 * Validate task completion using LLM self-reflection via agent.runDirect().
 * Collects full context (memory state, tool calls) so the validator can verify
 * what actually happened, not just what the agent claimed.
 *
 * LLM validation is OPT-IN: it only runs when the task explicitly sets
 * `validation.skipReflection = false` AND provides completionCriteria.
 * By default, tasks auto-pass with score 100.
 */
async function validateTaskCompletion(
  agent: Agent,
  task: Task,
  responseText: string,
  validationPromptBuilder: (task: Task, context: ValidationContext) => string,
  binding?: RoutineBinding,
): Promise<TaskValidationResult> {
  if (binding?.verified && task.validation?.requiredMemoryKeys?.length) {
    const { icmPlugin, wmPlugin } = getPlugins(agent);
    for (const key of task.validation.requiredMemoryKeys) if (await readMemoryValue(key, icmPlugin, wmPlugin) === undefined) return {
      isComplete: false, completionScore: 0, explanation: `Required memory key is missing: ${key}`, requiresUserApproval: false,
    };
  }
  // LLM validation is opt-in: only run when skipReflection is explicitly false
  // AND completion criteria are provided. Otherwise auto-pass.
  const hasExplicitValidation =
    task.validation?.skipReflection === false &&
    task.validation?.completionCriteria &&
    task.validation.completionCriteria.length > 0;

  if (!hasExplicitValidation) {
    return {
      isComplete: true,
      completionScore: 100,
      explanation: 'Auto-passed (LLM validation not enabled)',
      requiresUserApproval: false,
    };
  }

  // Collect full context snapshot for the validator
  const validationContext = await collectValidationContext(agent, responseText);

  const prompt = binding?.verified ? validationPromptBuilder(freezeData(boundedData(task, 1_048_576).data), freezeData(boundedData(validationContext, 1_048_576).data)) : validationPromptBuilder(task, validationContext);
  const directOptions = {
    instructions: 'You are a task completion evaluator. Return only JSON.',
    temperature: 0.1,
  };
  const response = await (binding ? binding.direct(prompt, { ...directOptions, purpose: 'verifier' }) : agent.runDirect(prompt, directOptions));

  const text = response.output_text ?? '';
  const extracted = extractJSON<{
    isComplete: boolean;
    completionScore: number;
    explanation: string;
  }>(text);

  if (!extracted.success || !extracted.data) {
    // Failed to parse validation response — treat as uncertain
    return {
      isComplete: false,
      completionScore: 0,
      explanation: `Failed to parse validation response: ${extracted.error ?? 'unknown error'}`,
      requiresUserApproval: false,
    };
  }

  const { completionScore, explanation } = extracted.data;
  const minScore = task.validation?.minCompletionScore ?? 80;

  return {
    isComplete: binding?.verified ? extracted.data.isComplete === true && Number.isFinite(completionScore) && completionScore <= 100 && completionScore >= minScore : completionScore >= minScore,
    completionScore,
    explanation,
    requiresUserApproval: false,
  };
}

// ============================================================================
// Deterministic Step Execution
// ============================================================================

const DEFAULT_STEP_TIMEOUT = 30_000;
const DEFAULT_ROUTINE_TIMEOUT = 3_600_000; // 1 hour

interface StepExecutionContext {
  binding?: RoutineBinding;
  agent: Agent;
  steps: DeterministicStep[];
  phase: 'pre' | 'post';
  inputs: Record<string, unknown>;
  execution: RoutineExecution;
  taskResults?: Map<string, unknown>;
  onStepStarted?: (step: DeterministicStep, phase: 'pre' | 'post', index: number, execution: RoutineExecution) => void;
  onStepComplete?: (step: DeterministicStep, phase: 'pre' | 'post', index: number, result: unknown, execution: RoutineExecution) => void;
  onStepFailed?: (step: DeterministicStep, phase: 'pre' | 'post', index: number, error: Error, execution: RoutineExecution) => void;
}

interface StepExecutionResult {
  success: boolean;
  results: Map<string, unknown>;
  errors: Array<{ stepName: string; error: string }>;
  /** All ICM/WM keys written by these steps (for cleanup). */
  usedResultKeys: string[];
}

/**
 * Execute an array of deterministic steps (no LLM).
 *
 * Each step calls a registered tool directly via agent.tools.execute(),
 * stores the result in ICM/WM, and respects per-step error handling.
 */
async function executeDeterministicSteps(ctx: StepExecutionContext): Promise<StepExecutionResult> {
  const { agent, steps, phase, inputs, execution, taskResults } = ctx;
  const { icmPlugin, wmPlugin } = getPlugins(agent);
  const log = logger.child({ phase, routine: 'deterministic-steps' });
  const stepResults = new Map<string, unknown>();
  const errors: Array<{ stepName: string; error: string }> = [];
  const usedResultKeys: string[] = [];

  const defaultOnError = phase === 'pre' ? 'fail' : 'continue';

  for (let i = 0; i < steps.length; i++) {
    ctx.binding?.signal.throwIfAborted();
    const step = steps[i]!;
    const onError = step.onError ?? defaultOnError;
    const resultKey = step.resultKey ??
      `${phase === 'pre' ? ROUTINE_KEYS.PRE_STEP_PREFIX : ROUTINE_KEYS.POST_STEP_PREFIX}${step.name}`;

    log.info({ stepName: step.name, toolName: step.toolName, index: i }, `Executing ${phase}-step`);
    ctx.onStepStarted?.(step, phase, i, execution);

    try {
      // Resolve template placeholders in args
      const resolveCtx: StepResolveContext = { inputs, taskResults, stepResults };
      const resolvedArgs = resolveStepArgs(step.args, resolveCtx);

      // Execute tool directly via the agent's ToolManager
      // Note: ToolManager's ResultNormalizerPlugin converts exceptions to
      // { success: false, error: '...' } objects instead of throwing.
      const timeoutMs = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT;
      const report = ctx.binding?.verified ? await agent.tools.executeWithOutcome(step.toolName, resolvedArgs, { signal: ctx.binding.signal, timeoutMs }) : undefined;
      const result = report ? report.result : ctx.binding ? await agent.tools.execute(step.toolName, resolvedArgs, {
        signal: ctx.binding.signal, timeoutMs,
      }) : await withTimeout(
        agent.tools.execute(step.toolName, resolvedArgs),
        timeoutMs,
        `${phase}-step "${step.name}"`
      );

      // Check for normalized error results (tool threw but pipeline recovered)
      if (report && report.outcome.status !== 'succeeded') throw new Error(report.outcome.error ?? report.outcome.status);
      if (!report && result && typeof result === 'object' && 'success' in result && result.success === false && 'error' in result) {
        throw new Error((result as { error: string }).error);
      }

      await ctx.binding?.verified?.step(execution, step, phase, i, 'succeeded', result, ctx.binding);

      // Store result
      stepResults.set(step.name, result);

      // Inject into ICM/WM for task access (preSteps) or downstream steps (postSteps)
      await storeResult(resultKey, `${phase}-step result: ${step.name}`, result, icmPlugin, wmPlugin);
      usedResultKeys.push(resultKey);

      log.info({ stepName: step.name }, `${phase}-step completed`);
      ctx.onStepComplete?.(step, phase, i, result, execution);
    } catch (error) {
      const errorMessage = (error as Error).message;
      log.error({ stepName: step.name, error: errorMessage }, `${phase}-step failed`);
      errors.push({ stepName: step.name, error: errorMessage });
      ctx.onStepFailed?.(step, phase, i, error as Error, execution);
      await ctx.binding?.verified?.step(execution, step, phase, i, 'failed', { error: errorMessage }, ctx.binding);

      if (onError === 'fail') {
        return { success: false, results: stepResults, errors, usedResultKeys };
      } else if (onError === 'skip-remaining') {
        break;
      }
      // 'continue' → proceed to next step
    }
  }

  return { success: true, results: stepResults, errors, usedResultKeys };
}

// ============================================================================
// Main Runner
// ============================================================================

/**
 * Execute a routine definition.
 *
 * Creates an Agent with working memory + in-context memory enabled, then runs
 * each task in dependency order. Between tasks, conversation history is cleared
 * but memory plugins persist, allowing tasks to share data via memory.
 *
 * @example
 * ```typescript
 * const execution = await executeRoutine({
 *   definition: myRoutine,
 *   connector: 'openai',
 *   model: 'gpt-4',
 *   tools: [myCustomTool],
 *   onTaskComplete: (task) => console.log(`✓ ${task.name}`),
 * });
 *
 * console.log(execution.status); // 'completed' | 'failed'
 * ```
 *
 * @example Caller-driven kickoff (caller bakes pre-loaded context into the
 * agent's instructions, library injects the first user message):
 * ```typescript
 * const agent = Agent.create({
 *   connector: 'openai',
 *   model: 'gpt-4',
 *   instructions: agentDef.instructions + '\n\n## Pre-loaded task\nFacts:\n- ...',
 *   tools,
 * });
 * const execution = await executeRoutine({
 *   definition: actionExecutorRoutine,
 *   agent,
 *   initialUserMessage: 'Execute the selected action: Send reply.',
 * });
 * ```
 */
export async function executeRoutine(options: ExecuteRoutineOptions): Promise<RoutineExecution> {
  const binding = routineBinding(options);
  const {
    definition,
    agent: existingAgent,
    connector,
    model,
    tools: extraTools,
    onTaskStarted,
    onTaskComplete,
    onTaskFailed,
    onTaskValidation,
    onStepStarted,
    onStepComplete,
    onStepFailed,
    hooks,
    prompts,
    inputs: rawInputs,
    disableToolScoping,
  } = options;

  // Validate: must provide either `agent` or `connector` + `model`
  if (!existingAgent && (!connector || !model)) {
    throw new Error('executeRoutine requires either `agent` or both `connector` and `model`');
  }

  // Validate and resolve input parameters
  const resolvedInputs = validateAndResolveInputs(definition.parameters, rawInputs);

  // ownsAgent flips to true when the runner constructs an agent (Mode 1) or a
  // scoped executor off the caller's superagent (Mode 2 + requiredTools).
  let ownsAgent = !existingAgent;
  const log = logger.child({ routine: definition.name });

  // 1. Create execution
  const execution = createRoutineExecution(definition);
  bindRoutineExecution(execution, binding);
  execution.status = 'running';
  execution.startedAt = Date.now();
  execution.lastUpdatedAt = Date.now();
  binding?.verified?.started(execution, binding);

  // 2. Resolve prompt builders
  const buildSystemPrompt = prompts?.system ?? defaultSystemPrompt;
  const userTaskPromptBuilder = prompts?.task ?? defaultTaskPrompt;
  const buildTaskPrompt = (task: Task) => binding?.verified ? userTaskPromptBuilder(freezeData(boundedData(task, 1_048_576).data), freezeData(boundedData(execution, 1_048_576).data)) : userTaskPromptBuilder(task, execution);
  const buildValidationPrompt = prompts?.validation ?? defaultValidationPrompt;

  // 3. Resolve agent: reuse existing or create new
  let agent: Agent;

  // Track hooks registered on an existing agent so we can unregister in finally
  const registeredHooks: Array<{ name: string; hook: Function }> = [];

  if (existingAgent) {
    // Mode 2: caller passed a "superagent" carrying the full tool surface.
    // If the routine declares requiredTools, build a scoped executor restricted
    // to exactly those tools — caller's superagent stays untouched.
    if (definition.requiredTools && definition.requiredTools.length > 0) {
      const missing = definition.requiredTools.filter(
        (name) => !existingAgent.tools.has(name),
      );
      if (missing.length > 0) {
        execution.status = 'failed';
        execution.error = `Missing required tools on agent: ${missing.join(', ')}`;
        execution.completedAt = Date.now();
        execution.lastUpdatedAt = Date.now();
        if (binding?.verified) await binding.verified.final(execution, binding);
        return execution;
      }

      if (disableToolScoping || binding?.verified) {
        // Opt-out: keep the caller's full superagent — preSteps + postSteps
        // can use any registered tool. The requiredTools check above served
        // only as a sanity gate. Hooks register/unregister on the existing
        // agent, same shape as the no-requiredTools fallback below.
        agent = existingAgent;
        if (hooks) {
          for (const name of ROUTINE_HOOK_NAMES) {
            const hook = hooks[name];
            if (hook) {
              agent.registerHook(name, hook as any);
              registeredHooks.push({ name, hook });
            }
          }
        }
      } else {
        agent = existingAgent.scopedTo(definition.requiredTools, {
          instructions: buildSystemPrompt(definition),
        });
        ownsAgent = true; // runner now owns the scoped executor

        if (hooks) {
          for (const name of ROUTINE_HOOK_NAMES) {
            const hook = hooks[name];
            if (hook) {
              agent.registerHook(name, hook as any);
            }
          }
        }
      }
    } else {
      // No requiredTools declared — fall back to legacy behavior: reuse the
      // caller's agent as-is, hooks register/unregister around the run.
      agent = existingAgent;

      if (hooks) {
        for (const name of ROUTINE_HOOK_NAMES) {
          const hook = hooks[name];
          if (hook) {
            agent.registerHook(name, hook as any);
            registeredHooks.push({ name, hook });
          }
        }
      }
    }
  } else {
    // Mode 1: Create new agent — we own lifecycle and destroy in finally

    // Collect tools
    const allTools: ToolFunction[] = [...(extraTools ?? [])];

    // Validate required tools
    if (definition.requiredTools && definition.requiredTools.length > 0) {
      const availableToolNames = new Set(allTools.map((t) => t.definition.function.name));
      const missing = definition.requiredTools.filter((name) => !availableToolNames.has(name));
      if (missing.length > 0) {
        execution.status = 'failed';
        execution.error = `Missing required tools: ${missing.join(', ')}`;
        execution.completedAt = Date.now();
        execution.lastUpdatedAt = Date.now();
        if (binding?.verified) await binding.verified.final(execution, binding);
        return execution;
      }
    }

    agent = Agent.create({
      connector: connector!,
      model: model!,
      tools: allTools,
      instructions: buildSystemPrompt(definition),
      hooks,
      context: {
        model: model!,
        features: {
          workingMemory: true,
          inContextMemory: true,
        },
      },
    });
  }

  // 4. Validate required plugins
  if (definition.requiredPlugins && definition.requiredPlugins.length > 0) {
    const missing = definition.requiredPlugins.filter(
      (name) => !agent.context.hasPlugin(name)
    );
    if (missing.length > 0) {
      if (ownsAgent) agent.destroy();
      execution.status = 'failed';
      execution.error = `Missing required plugins: ${missing.join(', ')}`;
      execution.completedAt = Date.now();
      execution.lastUpdatedAt = Date.now();
      if (binding?.verified) await binding.verified.final(execution, binding);
        return execution;
    }
  }

  const failureMode = definition.concurrency?.failureMode ?? 'fail-fast';

  // Track custom resultKeys from deterministic steps for cleanup (reused agents)
  const stepResultKeys: string[] = [];

  const { icmPlugin: savedICM, wmPlugin: savedWM } = getPlugins(agent);
  const customKeys = [...(definition.preSteps ?? []), ...(definition.postSteps ?? [])].flatMap(step => step.resultKey ? [step.resultKey] : []);
  const routineKey = (key: string) => FULL_CLEANUP_CONFIG.icmPrefixes.some(prefix => key.startsWith(prefix))
    || FULL_CLEANUP_CONFIG.wmPrefixes.some(prefix => key.startsWith(prefix)) || customKeys.includes(key);
  const icmBefore = binding?.verified ? savedICM?.getState().entries.filter(entry => routineKey(entry.key)) : undefined;
  const wmBefore = binding?.verified ? savedWM?.getState().entries.filter(entry => routineKey(entry.key)) : undefined;
  const restoreSelected = async () => {
    if (savedICM) for (const entry of savedICM.list()) if (routineKey(entry.key)) savedICM.delete(entry.key);
    if (savedWM) for (const entry of (await savedWM.query()).entries) if (routineKey(entry.key)) await savedWM.delete(entry.key);
    for (const entry of icmBefore ?? []) savedICM!.set(entry.key, entry.description, entry.value, entry.priority, entry.showInUI);
    for (const entry of wmBefore ?? []) await savedWM!.store(entry.key, entry.description, entry.value, { scope: entry.scope, priority: entry.basePriority, pinned: entry.pinned });
    for (const { name, hook } of registeredHooks) agent.unregisterHook(name as any, hook as any);
  };

  // Global routine timeout — cancels the agent if wall-clock time is exceeded
  const routineTimeoutMs = binding ? 0 : definition.timeoutMs !== undefined ? definition.timeoutMs : DEFAULT_ROUTINE_TIMEOUT;
  let routineTimedOut = false;
  let routineTimer: ReturnType<typeof setTimeout> | undefined;

  if (routineTimeoutMs > 0) {
    routineTimer = setTimeout(() => {
      routineTimedOut = true;
      agent.cancel(`Routine timed out after ${routineTimeoutMs}ms`);
    }, routineTimeoutMs);
  }

  try {
    // 5. Validate pre/post step tool names
    const stepToolNames = [
      ...(definition.preSteps ?? []).map(s => s.toolName),
      ...(definition.postSteps ?? []).map(s => s.toolName),
    ];
    if (stepToolNames.length > 0) {
      const missingStepTools = [...new Set(
        stepToolNames.filter(name => !agent.tools.hasToolFunction(name))
      )];
      if (missingStepTools.length > 0) {
        execution.status = 'failed';
        execution.error = `Missing tools required by pre/post steps: ${missingStepTools.join(', ')}`;
        execution.completedAt = Date.now();
        execution.lastUpdatedAt = Date.now();
        if (binding?.verified) await binding.verified.final(execution, binding);
        return execution;
      }
    }

    // 6. Prepare plugins — force any lazy bootstrap to complete before
    //    deterministic pre-steps run. Without this, plugins that resolve
    //    state on first `getContent()` (e.g. `MemoryPluginNextGen` which
    //    bootstraps `userEntityId` / `agentEntityId`) are still in their
    //    pre-bootstrap state when a pre-step invokes one of their tools,
    //    and identity tokens like `subject: 'me'` fail with "no user scope".
    //
    //    The agent's first LLM turn would have triggered `getContent()`
    //    naturally — for agents whose first action is a pre-step, we have
    //    to drive bootstrap explicitly. `prepare()` is optional on the
    //    plugin interface; plugins without lazy state are unaffected.
    try {
      const plugins = agent.context.getPlugins?.() ?? [];
      await Promise.all(
        plugins.map(async p => {
          if (typeof p.prepare === 'function') {
            try {
              await p.prepare();
            } catch (err) {
              log.error(
                { plugin: p.name, error: err instanceof Error ? err.message : String(err) },
                'Plugin prepare() failed; pre-steps using its tools may fail',
              );
            }
          }
        }),
      );
    } catch (err) {
      log.error(
        { error: err instanceof Error ? err.message : String(err) },
        'Failed to enumerate plugins for prepare(); continuing',
      );
    }

    // 6.5. Execute preSteps (deterministic, no LLM)
    if (definition.preSteps && definition.preSteps.length > 0) {
      log.info({ count: definition.preSteps.length }, 'Executing pre-steps');
      const preResult = await executeDeterministicSteps({
        binding,
        agent,
        steps: definition.preSteps,
        phase: 'pre',
        inputs: resolvedInputs,
        execution,
        onStepStarted: onStepStarted,
        onStepComplete: onStepComplete,
        onStepFailed: onStepFailed,
      });

      stepResultKeys.push(...preResult.usedResultKeys);

      if (!preResult.success) {
        execution.status = 'failed';
        execution.error = `Pre-step failed: ${preResult.errors.map(e => e.stepName).join(', ')}`;
        execution.completedAt = Date.now();
        execution.lastUpdatedAt = Date.now();
        if (binding?.verified) await binding.verified.final(execution, binding);
        return execution;
      }
    }

    // 7. Main execution loop
    let nextTasks = getNextExecutableTasks(execution.plan);

    // Tracks whether `initialUserMessage` has been consumed. Set to true after
    // the first task starts iterating; subsequent tasks fall through to the
    // standard prompt builder. Retries of the first task re-use the original
    // initial message (we capture once per outer task iteration).
    let initialMessageConsumed = false;

    while (nextTasks.length > 0) {
      binding?.signal.throwIfAborted();
      // Check routine timeout before starting next task
      if (routineTimedOut) {
        log.warn('Routine timeout detected between tasks, aborting');
        break;
      }

      // Pick first task (sequential for now; parallel support can be added later)
      const task = nextTasks[0]!;
      const taskIndex = execution.plan.tasks.findIndex((t) => t.id === task.id);

      log.info({ taskName: task.name, taskId: task.id }, 'Starting task');

      if (binding?.verified && task.condition) {
        const disposition = await binding.verified.condition(execution, task, binding);
        if (disposition !== 'run') {
          execution.plan.tasks[taskIndex] = updateTaskStatus(task, disposition === 'skip' ? 'completed' : 'failed');
          execution.plan.tasks[taskIndex]!.result = { success: disposition === 'skip', output: { skipped: true } };
          await binding.verified.task(execution, execution.plan.tasks[taskIndex]!, binding, undefined, undefined, undefined, disposition === 'skip');
          if (disposition === 'fail' && failureMode === 'fail-fast') { execution.status = 'failed'; break; }
          nextTasks = getNextExecutableTasks(execution.plan); continue;
        }
      }
      // Set task to in_progress
      execution.plan.tasks[taskIndex] = updateTaskStatus(task, 'in_progress');
      execution.lastUpdatedAt = Date.now();
      onTaskStarted?.(execution.plan.tasks[taskIndex]!, execution);

      let taskCompleted = false;
      const maxTaskIterations = task.execution?.maxIterations ?? 50;

      // Safety: limit iterations per task via pause:check hook.
      // When exceeded, cancel the agent to break out of the run loop.
      // We reset _cancelled after each agent.run() so the next task can proceed.
      const iterationLimiter = async (ctx: { iteration: number }) => {
        if (ctx.iteration >= maxTaskIterations) {
          agent.cancel(`Task "${task.name}" exceeded max iterations (${maxTaskIterations})`);
        }
        return { shouldPause: false };
      };
      agent.registerHook('pause:check', iterationLimiter);

      // Capture once-per-task whether this iteration of the outer loop should
      // use the caller-supplied `initialUserMessage` instead of the standard
      // task prompt builder. Retries of THIS task share the same flag; the
      // next outer task falls back to the default builder.
      const useInitialMessageForThisTask =
        !initialMessageConsumed && !!options.initialUserMessage;
      initialMessageConsumed = true;

      try {
        // Helper to get the live task reference (updateTaskStatus returns new objects)
        const getTask = () => execution.plan.tasks[taskIndex]!;

        // Inject routine context (plan overview + dependency results) before task runs
        await injectRoutineContext(agent, execution, definition, getTask());

        // Resolve ICM plugin for template resolution
        const { icmPlugin } = getPlugins(agent);

        // Control flow branch: map/fold/until handle their own execution
        if (getTask().controlFlow) {
          try {
            const cfResult = await executeControlFlow(agent, getTask(), resolvedInputs, execution);

            await binding?.verified?.task(execution, { ...getTask(), result: { success: cfResult.completed, output: cfResult.result, error: cfResult.error } }, binding);
            if (binding?.verified || cfResult.completed) {
              execution.plan.tasks[taskIndex] = updateTaskStatus(getTask(), 'completed');
              execution.plan.tasks[taskIndex]!.result = { success: true, output: cfResult.result };
              taskCompleted = true;
              execution.progress = getRoutineProgress(execution);
              execution.lastUpdatedAt = Date.now();
              onTaskComplete?.(execution.plan.tasks[taskIndex]!, execution);
            } else {
              execution.plan.tasks[taskIndex] = updateTaskStatus(getTask(), 'failed');
              execution.plan.tasks[taskIndex]!.result = { success: false, error: cfResult.error };
            }
          } catch (error) {
            const errorMessage = (error as Error).message;
            log.error({ taskName: getTask().name, error: errorMessage }, 'Control flow error');
            execution.plan.tasks[taskIndex] = updateTaskStatus(getTask(), 'failed');
            execution.plan.tasks[taskIndex]!.result = { success: false, error: errorMessage };
          }
        } else {
          // Standard task execution — retry loop
          // First attempt is already counted by updateTaskStatus(task, 'in_progress') above.
          // Loop until task succeeds, fails definitively, or exhausts maxAttempts.
          while (!taskCompleted) {
            try {
              // Resolve templates in task description and expectedOutput
              const resolvedTask = resolveTaskTemplates(getTask(), resolvedInputs, icmPlugin);

              // Build task prompt — caller may override the FIRST task's prompt
              // entirely via options.initialUserMessage (e.g. for kickoff
              // routines where the routine itself doesn't template per-task).
              const taskPromptBase = useInitialMessageForThisTask
                ? options.initialUserMessage!
                : buildTaskPrompt(resolvedTask);

              const taskPrompt = binding?.verified
                ? [(prompts?.system ? prompts.system(freezeData(boundedData(definition, 1_048_576).data)) : definition.instructions ?? ''), 'Complete only this task. Use the available context plugins and their documented tools for cross-task data; do not repeat settled actions.', taskPromptBase].filter(Boolean).join('\n\n') : taskPromptBase;
              // Run agent
              const response = await (binding ? binding.run(taskPrompt) : agent.run(taskPrompt));
              const responseText = response.output_text ?? '';

              // Validate
              const validationResult = await validateTaskCompletion(
                agent,
                getTask(),
                responseText,
                buildValidationPrompt,
                binding,
              );

              await binding?.verified?.task(execution, getTask(), binding, response, validationResult,
                () => validateTaskCompletion(agent, getTask(), responseText, buildValidationPrompt, binding));
              // Notify caller of validation result
              onTaskValidation?.(getTask(), validationResult, execution);

              if (binding?.verified || validationResult.isComplete) {
                // Mark completed
                execution.plan.tasks[taskIndex] = updateTaskStatus(getTask(), 'completed');
                execution.plan.tasks[taskIndex]!.result = {
                  success: true,
                  output: responseText,
                  validationScore: validationResult.completionScore,
                  validationExplanation: validationResult.explanation,
                };
                taskCompleted = true;

                log.info(
                  { taskName: getTask().name, score: validationResult.completionScore },
                  'Task completed'
                );

                execution.progress = getRoutineProgress(execution);
                execution.lastUpdatedAt = Date.now();
                onTaskComplete?.(execution.plan.tasks[taskIndex]!, execution);
              } else {
                // Validation failed
                log.warn(
                  {
                    taskName: getTask().name,
                    score: validationResult.completionScore,
                    attempt: getTask().attempts,
                    maxAttempts: getTask().maxAttempts,
                  },
                  'Task validation failed'
                );

                if (getTask().attempts >= getTask().maxAttempts) {
                  // Max attempts exceeded — mark failed
                  execution.plan.tasks[taskIndex] = updateTaskStatus(getTask(), 'failed');
                  execution.plan.tasks[taskIndex]!.result = {
                    success: false,
                    error: validationResult.explanation,
                    validationScore: validationResult.completionScore,
                    validationExplanation: validationResult.explanation,
                  };
                  break;
                }

                // Retry — don't clear conversation so agent can build on previous attempt
                // Re-set in_progress to increment attempts counter
                execution.plan.tasks[taskIndex] = updateTaskStatus(getTask(), 'in_progress');
              }
            } catch (error) {
              const errorMessage = (error as Error).message;
              log.error({ taskName: getTask().name, error: errorMessage }, 'Task execution error');

              if (!isTransientError(error) || getTask().attempts >= getTask().maxAttempts) {
                await binding?.verified?.task(execution, { ...getTask(), result: { success: false, error: errorMessage } }, binding);
                if (binding?.verified) {
                  execution.plan.tasks[taskIndex] = updateTaskStatus(getTask(), 'completed');
                  execution.plan.tasks[taskIndex]!.result = { success: true, output: { reconciledError: errorMessage } };
                  taskCompleted = true; break;
                }
                // Permanent error or max attempts exceeded — mark failed
                execution.plan.tasks[taskIndex] = updateTaskStatus(getTask(), 'failed');
                execution.plan.tasks[taskIndex]!.result = {
                  success: false,
                  error: errorMessage,
                };
                break;
              }

              // Transient error — retry
              execution.plan.tasks[taskIndex] = updateTaskStatus(getTask(), 'in_progress');
            }
          }
        }

        // Handle task failure
        if (!taskCompleted) {
          execution.progress = getRoutineProgress(execution);
          execution.lastUpdatedAt = Date.now();
          onTaskFailed?.(execution.plan.tasks[taskIndex]!, execution);

          if (failureMode === 'fail-fast') {
            execution.status = 'failed';
            execution.error = `Task "${getTask().name}" failed after ${getTask().attempts} attempt(s)`;
            execution.completedAt = Date.now();
            execution.lastUpdatedAt = Date.now();
            break;
          }
          // 'continue' mode: skip this task, proceed to next
        }
      } finally {
        // Always unregister per-task iteration limiter — even on error/break paths
        try { agent.unregisterHook('pause:check', iterationLimiter); } catch { /* already unregistered */ }
      }

      // Clear conversation for next task (memory persists)
      if (!binding?.verified?.preserve()) agent.clearConversation('task-boundary');

      // Get next executable tasks
      nextTasks = getNextExecutableTasks(execution.plan);
    }

    // Finalize
    if (execution.status === 'running') {
      // Check if all tasks are terminal
      const allTerminal = execution.plan.tasks.every((t) => isTerminalStatus(t.status));
      const allCompleted = execution.plan.tasks.every((t) => t.status === 'completed');

      if (allCompleted) {
        execution.status = 'completed';
      } else if (allTerminal) {
        // Some failed/skipped but all are terminal
        execution.status = 'failed';
        execution.error = 'Not all tasks completed successfully';
      } else {
        // Blocked tasks remain — deadlock
        execution.status = 'failed';
        execution.error = 'Execution stalled: remaining tasks are blocked by incomplete dependencies';
      }

      execution.completedAt = Date.now();
      execution.lastUpdatedAt = Date.now();
      execution.progress = getRoutineProgress(execution);
    }

    // Enrich error message if the failure was caused by the routine timeout
    if (routineTimedOut && execution.status === 'failed') {
      execution.error = `Routine timed out after ${routineTimeoutMs}ms` +
        (execution.error ? `; ${execution.error}` : '');
    }

    // Clear routine timer before postSteps so cleanup steps aren't killed
    if (routineTimer) {
      clearTimeout(routineTimer);
      routineTimer = undefined;
    }

    // 8. Execute postSteps (deterministic, no LLM)
    const shouldRunPostSteps =
      definition.postSteps &&
      definition.postSteps.length > 0 &&
      (definition.postStepsTrigger === 'always' || execution.status === 'completed');

    if (shouldRunPostSteps) {
      binding?.signal.throwIfAborted();
      // Build task results map for {{result.TASK_ID_OR_NAME}} resolution.
      // Tasks carry both a canonical `id` (referenced by `dependsOn`,
      // control-flow ops, etc.) and a human-readable `name` (display label).
      // Index by BOTH so `{{result.<id>}}` and `{{result.<name>}}` resolve —
      // matches the convention used everywhere else in the runner where the
      // id is the canonical reference and the name is for display.
      const taskResults = new Map<string, unknown>();
      for (const task of execution.plan.tasks) {
        if (task.status === 'completed' && (binding?.verified ? task.result && 'output' in task.result : task.result?.output)) {
          taskResults.set(task.name, task.result!.output);
          if (task.id && task.id !== task.name) {
            taskResults.set(task.id, task.result!.output);
          }
        }
      }

      log.info({ count: definition.postSteps!.length }, 'Executing post-steps');
      const postResult = await executeDeterministicSteps({
        binding,
        agent,
        steps: definition.postSteps!,
        phase: 'post',
        inputs: resolvedInputs,
        execution,
        taskResults,
        onStepStarted: onStepStarted,
        onStepComplete: onStepComplete,
        onStepFailed: onStepFailed,
      });

      stepResultKeys.push(...postResult.usedResultKeys);

      if (!postResult.success) {
        const postStepError = `Post-step failed: ${postResult.errors.map(e => e.stepName).join(', ')}`;
        if (execution.status === 'completed') {
          // Routine succeeded but post-step failed — downgrade to failed
          execution.status = 'failed';
          execution.error = postStepError;
        } else {
          // Routine already failed — append post-step error to preserve both
          execution.error = `${execution.error}; ${postStepError}`;
        }
        execution.lastUpdatedAt = Date.now();
      }
    }

    await binding?.verified?.final(execution, binding);
    log.info(
      { status: execution.status, progress: execution.progress },
      'Routine execution finished'
    );

    return execution;
  } finally {
    // Clear routine timeout timer (may already be cleared before postSteps)
    if (routineTimer) clearTimeout(routineTimer);

    if (binding?.verified) {
      // Recovery retries local restoration only, never a step/action.
      await binding.verified.cleanup(execution, binding, restoreSelected);
    }
    // Clean up routine-managed keys from ICM/WM (important for reused agents)
    try {
      if (!binding?.verified) await cleanupRoutineContext(agent, stepResultKeys);
    } catch (e) {
      log.debug({ error: (e as Error).message }, 'Failed to clean up routine context');
    }

    // Unregister routine-specific hooks from existing agent
    for (const { name, hook } of binding?.verified ? [] : registeredHooks) {
      try {
        agent.unregisterHook(name as any, hook as any);
      } catch (e) {
        log.debug({ hookName: name, error: (e as Error).message }, 'Failed to unregister hook');
      }
    }

    if (ownsAgent) {
      try {
        agent.destroy();
      } catch (e) {
        log.debug({ error: (e as Error).message }, 'Failed to destroy agent');
      }
    }
  }
}
