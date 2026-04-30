/**
 * `request_user_input` tool factory.
 *
 * Wraps an app-supplied `IUserInteractionDelivery` with the standard
 * `SuspendSignal` plumbing so an agent can pause, ask the user a question
 * over any channel, and resume when the reply arrives.
 *
 * Library responsibility: produce the tool, validate inputs, call the
 * delivery, and return a `SuspendSignal` carrying the correlation id.
 *
 * App responsibility: implement the channel (Slack, email, in-app, ...),
 * embed the correlation id in the outbound message, listen for replies, and
 * resume via `ICorrelationStorage.resolve()` + `Agent.hydrate()` +
 * `agent.run(reply)`.
 *
 * @example
 * ```typescript
 * import { Agent, createRequestUserInputTool } from '@everworker/oneringai';
 *
 * const slackDelivery: IUserInteractionDelivery = {
 *   id: 'slack',
 *   async send(req, ctx) {
 *     const { ts, channel } = await slack.chat.postMessage({
 *       channel: ctx.userId!,
 *       text: req.prompt,
 *       metadata: { event_type: 'request_user_input', event_payload: { agentId: ctx.agentId } },
 *     });
 *     return {
 *       correlationId: `slack:${channel}/${ts}`,
 *       channel: 'slack',
 *       description: `Slack DM sent to <@${ctx.userId}> — waiting for reply`,
 *       metadata: { ts, channel },
 *     };
 *   },
 * };
 *
 * const agent = Agent.create({
 *   connector: 'openai',
 *   model: 'gpt-4',
 *   tools: [createRequestUserInputTool(slackDelivery)],
 * });
 * ```
 */

import { SuspendSignal, type SuspendSignalOptions } from '../../core/SuspendSignal.js';
import type { ToolFunction } from '../../domain/entities/Tool.js';
import { logger } from '../../infrastructure/observability/Logger.js';
import type {
  IUserInteractionDelivery,
  UserInteractionRequest,
  UserInteractionDeliveryContext,
} from './types.js';

export interface CreateRequestUserInputToolOptions {
  /** Tool name surfaced to the LLM. Default: `'request_user_input'`. */
  toolName?: string;

  /**
   * Override the tool description. The default description tells the model
   * to call this when it genuinely needs a human decision/answer that it
   * cannot produce itself, and warns that the agent will pause until reply.
   */
  description?: string;

  /**
   * SuspendSignal TTL in milliseconds (how long to keep the correlation
   * before it expires). Defaults to the library's `SuspendSignal` default
   * (7 days at the time of writing).
   */
  ttl?: number;

  /**
   * How the user's reply should be injected when the session resumes.
   *
   *  - `'tool_result'` (default): the reply becomes the tool's actual
   *    output — semantically honest ("I asked → user answered → tool
   *    returned").
   *  - `'user_message'`: reply is added as a fresh user turn — useful when
   *    you want the resumed turn to feel conversational.
   */
  resumeAs?: 'user_message' | 'tool_result';
}

const DEFAULT_TOOL_NAME = 'request_user_input';
const DEFAULT_DESCRIPTION = `Pause execution and ask the user a question over an external channel (e.g., Slack, email, in-app notification). The agent will suspend until the user replies — possibly minutes, hours, or days later.

USE WHEN:
- You genuinely need a human decision, answer, approval, or clarification you cannot produce yourself.
- A long-running routine has reached a checkpoint that requires human input.

DO NOT USE WHEN:
- You can answer from your own context, knowledge, or available tools.
- You only need to inform the user (no reply expected) — use a notify/send tool instead.

The agent will not run again until the user replies. Make the prompt clear and self-contained.`;

interface RequestUserInputToolArgs extends UserInteractionRequest {}

interface RequestUserInputToolDisplayResult {
  /** Channel the prompt was delivered on. */
  channel: string;
  /** Correlation id used to resume the session (opaque to the LLM). */
  correlationId: string;
  /** Human-readable confirmation, e.g., "Slack DM to @alice — waiting for reply". */
  message: string;
  /** Whether the agent is now suspended (always true on success). */
  suspended: true;
}

/**
 * Create a `request_user_input` tool bound to the given delivery.
 *
 * The returned tool, when called by the agent, returns a `SuspendSignal` —
 * the agent loop catches it, performs a final wrap-up LLM call without tools,
 * saves the session, persists the correlation, and returns
 * `AgentResponse { status: 'suspended' }` to the caller.
 */
export function createRequestUserInputTool(
  delivery: IUserInteractionDelivery,
  options: CreateRequestUserInputToolOptions = {},
): ToolFunction<RequestUserInputToolArgs, SuspendSignal> {
  const toolName = options.toolName ?? DEFAULT_TOOL_NAME;
  const description = options.description ?? DEFAULT_DESCRIPTION;
  const resumeAs = options.resumeAs ?? 'tool_result';
  const ttl = options.ttl;

  return {
    definition: {
      type: 'function',
      function: {
        name: toolName,
        description,
        parameters: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description:
                'The question or message to deliver to the user. Make it clear, complete, and answerable on its own — the user may see it without surrounding context.',
            },
            context: {
              type: 'string',
              description:
                'Optional human-readable preamble (why you are asking, what triggered this). Channels may render it as a header or subject.',
            },
            schema: {
              type: 'object',
              description:
                'Optional JSON Schema describing the expected reply shape. Form-rendering channels may use it; free-text channels typically ignore it.',
              additionalProperties: true,
            },
            metadata: {
              type: 'object',
              description:
                'Optional channel-specific extras (recipient hint, priority, channel preference, etc.). Forwarded to the delivery as-is.',
              additionalProperties: true,
            },
          },
          required: ['prompt'],
        },
      },
    },

    permission: {
      scope: 'always',
      riskLevel: 'low',
    },

    describeCall: (args) => {
      const prompt = typeof args?.prompt === 'string' ? args.prompt : '';
      if (!prompt) return 'asking user';
      return prompt.length > 80 ? `${prompt.slice(0, 77)}...` : prompt;
    },

    execute: async (args, context): Promise<SuspendSignal> => {
      const prompt = args?.prompt;
      if (typeof prompt !== 'string' || prompt.trim().length === 0) {
        // Fail loudly — empty prompts indicate a model error, not a delivery problem.
        const err = new Error(
          `${toolName}: 'prompt' is required and must be a non-empty string`,
        );
        logger.error(
          { toolName, args },
          'request_user_input called with empty/missing prompt',
        );
        throw err;
      }

      const ctx: UserInteractionDeliveryContext = {
        agentId: context?.agentId,
        sessionId: context?.sessionId,
        userId: context?.userId,
      };

      const request: UserInteractionRequest = {
        prompt,
        context: args.context,
        schema: args.schema,
        metadata: args.metadata,
      };

      let result: Awaited<ReturnType<IUserInteractionDelivery['send']>>;
      try {
        result = await delivery.send(request, ctx);
      } catch (error) {
        // Per project rules: never silent. Log with full context, then rethrow
        // so the agent loop records a failed tool call (no suspension).
        logger.error(
          {
            err: error,
            toolName,
            deliveryId: delivery.id,
            agentId: ctx.agentId,
            sessionId: ctx.sessionId,
            userId: ctx.userId,
            promptLength: prompt.length,
          },
          'request_user_input delivery failed',
        );
        throw error instanceof Error
          ? error
          : new Error(
              `${toolName}: delivery failed — ${typeof error === 'string' ? error : JSON.stringify(error)}`,
            );
      }

      if (!result || typeof result.correlationId !== 'string' || result.correlationId.length === 0) {
        const err = new Error(
          `${toolName}: delivery returned no correlationId — implementation error in '${delivery.id ?? 'unknown'}'`,
        );
        logger.error(
          { toolName, deliveryId: delivery.id, result },
          'request_user_input delivery returned invalid result',
        );
        throw err;
      }

      const channel = result.channel || delivery.id || 'unknown';
      const message =
        result.description ||
        `User input requested via ${channel} — waiting for reply (correlationId: ${result.correlationId})`;

      const displayResult: RequestUserInputToolDisplayResult = {
        channel,
        correlationId: result.correlationId,
        message,
        suspended: true,
      };

      logger.info(
        {
          toolName,
          channel,
          correlationId: result.correlationId,
          agentId: ctx.agentId,
          sessionId: ctx.sessionId,
        },
        'request_user_input suspending agent',
      );

      const suspendOptions: SuspendSignalOptions = {
        result: displayResult,
        correlationId: result.correlationId,
        resumeAs,
        metadata: {
          channel,
          ...(result.metadata ?? {}),
          ...(args.metadata ?? {}),
        },
      };
      if (ttl !== undefined) {
        suspendOptions.ttl = ttl;
      }
      return SuspendSignal.create(suspendOptions);
    },
  };
}

// Re-export the display result type so apps can introspect tool results when
// rendering history (e.g., showing "asked user X via slack" in a UI).
export type { RequestUserInputToolDisplayResult };
