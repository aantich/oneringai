/**
 * ICorrelationStorage - Maps external event IDs to suspended agent sessions
 *
 * When an agent suspends (via SuspendSignal), a correlation entry is saved
 * linking the external event identifier (e.g., email message ID, ticket ID)
 * to the agent session. When the external event arrives (webhook, reply, etc.),
 * the app resolves the correlation to find which session to resume.
 *
 * Default implementation: FileCorrelationStorage (~/.oneringai/correlations/)
 *
 * @example
 * ```typescript
 * // Save correlation when agent suspends
 * await correlationStorage.save('email:msg_123', {
 *   agentId: 'my-agent',
 *   sessionId: 'session-456',
 *   suspendedAt: new Date().toISOString(),
 *   expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
 *   resumeAs: 'user_message',
 * });
 *
 * // Resolve when external event arrives
 * const ref = await correlationStorage.resolve('email:msg_123');
 * if (ref) {
 *   const agent = await Agent.hydrate(ref.sessionId, { agentId: ref.agentId });
 *   await agent.run(userReply);
 * }
 * ```
 */

/**
 * Reference to a suspended agent session
 */
export interface SessionRef {
  /** Agent identifier (used to load agent definition) */
  agentId: string;

  /** Session identifier (used to load conversation + plugin state) */
  sessionId: string;

  /** ISO timestamp when the session was suspended */
  suspendedAt: string;

  /** ISO timestamp when this correlation expires */
  expiresAt: string;

  /**
   * How the external response should be injected:
   * - `'user_message'`: as a new user message (default)
   * - `'tool_result'`: as a tool result
   */
  resumeAs: 'user_message' | 'tool_result';

  /** Application-specific metadata from the SuspendSignal */
  metadata?: Record<string, unknown>;
}

/**
 * Options for listing correlations
 */
export interface CorrelationListOptions {
  /** Only return non-expired correlations */
  activeOnly?: boolean;

  /** Limit results */
  limit?: number;
}

/**
 * Summary of a stored correlation
 */
export interface CorrelationSummary {
  correlationId: string;
  agentId: string;
  sessionId: string;
  suspendedAt: string;
  expiresAt: string;
  isExpired: boolean;
}

/**
 * Storage interface for correlation mappings between external events and sessions
 */
export interface ICorrelationStorage {
  /**
   * Save a correlation mapping.
   * If a correlation with the same ID already exists, it is overwritten.
   */
  save(correlationId: string, ref: SessionRef): Promise<void>;

  /**
   * Resolve a correlation ID to a session reference.
   * Returns null if not found or expired.
   */
  resolve(correlationId: string): Promise<SessionRef | null>;

  /**
   * Delete a correlation mapping.
   */
  delete(correlationId: string): Promise<void>;

  /**
   * Check if a correlation exists and is not expired.
   */
  exists(correlationId: string): Promise<boolean>;

  /**
   * List all correlations for a given session.
   * Useful for cleanup when a session is resumed or deleted.
   */
  listBySession(sessionId: string): Promise<string[]>;

  /**
   * List all correlations for a given agent.
   */
  listByAgent(agentId: string): Promise<CorrelationSummary[]>;

  /**
   * Remove all expired correlations.
   * @returns Number of correlations pruned
   */
  pruneExpired(): Promise<number>;

  /**
   * Get the storage path (for debugging/logging).
   */
  getPath(): string;
}
