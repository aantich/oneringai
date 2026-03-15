/**
 * Tool context interface - passed to tools during execution
 *
 * This is a SIMPLE interface. Tools receive only what they need:
 * - agentId: For logging/tracing
 * - taskId: For task-aware operations
 * - memory: For storing/retrieving data
 * - signal: For cancellation
 *
 * Plugins and context management are NOT exposed to tools.
 * Tools should be self-contained and not depend on framework internals.
 */

import type { MemoryScope, MemoryPriority } from '../entities/Memory.js';
import type { IConnectorRegistry } from './IConnectorRegistry.js';
import type { AuthIdentity } from '../../core/context-nextgen/types.js';

/**
 * Limited memory access for tools
 *
 * This interface is designed to work with all agent types:
 * - Basic agents: Use simple scopes ('session', 'persistent')
 * - TaskAgent: Use task-aware scopes ({ type: 'task', taskIds: [...] })
 * - UniversalAgent: Switches between simple and task-aware based on mode
 */
export interface WorkingMemoryAccess {
  get(key: string): Promise<unknown>;

  /**
   * Store a value in memory
   *
   * @param key - Unique key for the entry
   * @param description - Short description (max 150 chars)
   * @param value - Data to store
   * @param options - Optional scope, priority, and pinning
   */
  set(
    key: string,
    description: string,
    value: unknown,
    options?: {
      /** Scope determines lifecycle - defaults to 'session' */
      scope?: MemoryScope;
      /** Base priority for eviction ordering */
      priority?: MemoryPriority;
      /** If true, entry is never evicted */
      pinned?: boolean;
    }
  ): Promise<void>;

  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;

  /**
   * List all memory entries
   * Returns key, description, and computed priority info
   */
  list(): Promise<
    Array<{
      key: string;
      description: string;
      effectivePriority?: MemoryPriority;
      pinned?: boolean;
    }>
  >;
}

/**
 * Context passed to tool execute function
 *
 * Simple and clean - only what tools actually need.
 */
export interface ToolContext {
  /** Agent ID (for logging/tracing) */
  agentId?: string;

  /** Task ID (if running in TaskAgent) */
  taskId?: string;

  /** User ID — auto-populated from Agent config (userId). Also settable manually via agent.tools.setToolContext(). */
  userId?: string;

  /** Account alias for multi-account OAuth — auto-populated from Agent config (accountId). Allows one user to auth multiple external accounts on the same connector (e.g., 'work', 'personal'). */
  accountId?: string;

  /** Auth identities this agent is scoped to (for identity-aware tool descriptions) */
  identities?: AuthIdentity[];

  /** Connector registry scoped to this agent's allowed connectors and userId */
  connectorRegistry?: IConnectorRegistry;

  /** User roles for permission policy evaluation */
  roles?: string[];

  /** Session ID for approval cache scoping */
  sessionId?: string;

  /** Working memory access (if agent has memory feature enabled) */
  memory?: WorkingMemoryAccess;

  /** Abort signal for cancellation */
  signal?: AbortSignal;
}
