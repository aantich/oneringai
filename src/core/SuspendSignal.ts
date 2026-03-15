/**
 * SuspendSignal - Signal returned by tools to suspend the agent loop
 *
 * When a tool returns a SuspendSignal, the agent loop:
 * 1. Adds the `result` field as the normal tool result (visible to LLM)
 * 2. Does one final LLM call without tools for a graceful wrap-up message
 * 3. Saves the session and correlation mapping
 * 4. Returns an AgentResponse with status: 'suspended'
 *
 * Later, `Agent.hydrate()` reconstructs the agent from stored definition +
 * session, and the caller runs `agent.run(userReply)` to continue.
 *
 * @example
 * ```typescript
 * import { SuspendSignal } from '@everworker/oneringai';
 *
 * const presentToUser: ToolFunction = {
 *   definition: { ... },
 *   execute: async (args) => {
 *     const { messageId } = await emailService.send(args.to, args.subject, args.body);
 *     return SuspendSignal.create({
 *       result: `Email sent to ${args.to}. Waiting for reply.`,
 *       correlationId: `email:${messageId}`,
 *     });
 *   },
 * };
 * ```
 */

/** Default TTL: 7 days in milliseconds */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Options for creating a SuspendSignal
 */
export interface SuspendSignalOptions {
  /** The tool result visible to the LLM (e.g., "Email sent to user@example.com") */
  result: unknown;

  /**
   * Unique identifier for routing external events back to this session.
   * Typically prefixed by channel (e.g., "email:msg_123", "ticket:T-456")
   */
  correlationId: string;

  /**
   * How the external response should be injected when the session resumes.
   * - `'user_message'` (default): added as a new user message
   * - `'tool_result'`: added as a tool result
   */
  resumeAs?: 'user_message' | 'tool_result';

  /** Time-to-live in milliseconds before the suspended session expires. Default: 7 days */
  ttl?: number;

  /** Application-specific metadata (email ID, ticket ID, webhook URL, etc.) */
  metadata?: Record<string, unknown>;
}

/**
 * Signal that a tool has initiated an external operation and the agent
 * loop should suspend until an external event resumes it.
 */
export class SuspendSignal {
  /** The tool result visible to the LLM */
  readonly result: unknown;

  /** Correlation identifier for routing external events back */
  readonly correlationId: string;

  /** How the external response is injected on resume */
  readonly resumeAs: 'user_message' | 'tool_result';

  /** Time-to-live in milliseconds */
  readonly ttl: number;

  /** Application-specific metadata */
  readonly metadata?: Record<string, unknown>;

  private constructor(options: SuspendSignalOptions) {
    this.result = options.result;
    this.correlationId = options.correlationId;
    this.resumeAs = options.resumeAs ?? 'user_message';
    this.ttl = options.ttl ?? DEFAULT_TTL_MS;
    this.metadata = options.metadata;
  }

  /**
   * Create a new SuspendSignal.
   *
   * @example
   * ```typescript
   * return SuspendSignal.create({
   *   result: 'Email sent to user@example.com. Waiting for reply.',
   *   correlationId: `email:${messageId}`,
   *   metadata: { messageId, sentTo: email },
   * });
   * ```
   */
  static create(options: SuspendSignalOptions): SuspendSignal {
    if (!options.correlationId) {
      throw new Error('SuspendSignal requires a correlationId');
    }
    return new SuspendSignal(options);
  }

  /**
   * Type guard to check if a value is a SuspendSignal.
   */
  static is(value: unknown): value is SuspendSignal {
    return value instanceof SuspendSignal;
  }
}
