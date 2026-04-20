/**
 * MemoryWritePluginNextGen — lightweight sidecar that adds write tools to an
 * agent that already has `MemoryPluginNextGen` (read-only) registered.
 *
 * Split from `MemoryPluginNextGen` so that:
 *   - Read-only agents don't pay the write-tool schema overhead in every turn.
 *   - Autonomous architectures (main agent reads; a `SessionIngestorPluginNextGen`
 *     or similar pipeline writes) can cleanly forbid direct writes from the
 *     agent.
 *
 * This plugin:
 *   - Injects NO system-message content (reads already handle profile injection).
 *   - Ships only the 5 write tools: memory_remember, memory_link, memory_forget,
 *     memory_restore, memory_upsert_entity.
 *   - Provides a short write-specific instruction block.
 *   - Does NOT bootstrap user/agent entities — that's `MemoryPluginNextGen`'s
 *     job. Host must register `MemoryPluginNextGen` first; write tools that
 *     use `"me"` / `"this_agent"` tokens rely on its bootstrap.
 */

import type { IContextPluginNextGen, ITokenEstimator } from '../types.js';
import type { ToolFunction } from '../../../domain/entities/Tool.js';
import type { MemorySystem } from '../../../memory/index.js';
import { simpleTokenEstimator } from '../BasePluginNextGen.js';
import { createMemoryWriteTools, type Visibility } from '../../../tools/memory/index.js';

export interface MemoryWritePluginConfig {
  /** Live memory system. REQUIRED. */
  memory: MemorySystem;
  /** Agent id. REQUIRED — matches `MemoryPluginNextGen.agentId`. */
  agentId: string;
  /** Current user id. REQUIRED — matches `MemoryPluginNextGen.userId`. */
  userId: string;
  /** Trusted group id from host auth. Matches `MemoryPluginNextGen.groupId`. */
  groupId?: string;
  /** Default visibility for remember/link. Matches MemoryPlugin defaults. */
  defaultVisibility?: {
    forUser?: Visibility;
    forAgent?: Visibility;
    forOther?: Visibility;
  };
  /** Fuzzy-match threshold for `{surface}` subject lookups. Default 0.9. */
  autoResolveThreshold?: number;
  /**
   * Callback supplied by the sibling `MemoryPluginNextGen` so `"me"` /
   * `"this_agent"` tokens resolve to its bootstrapped entities. When absent,
   * those tokens return "not available".
   */
  getOwnSubjectIds?: () => { userEntityId?: string; agentEntityId?: string };
  /** Rate-limit override for memory_forget. */
  forgetRateLimit?: { maxCallsPerWindow?: number; windowMs?: number };
}

const WRITE_INSTRUCTIONS = `## Memory writes

You have direct write access to the memory store:
- memory_remember — record an atomic fact (subject, predicate, value/details).
- memory_link — relate two entities with a predicate.
- memory_upsert_entity — create or merge an entity by identifier (email, slack_id, domain, etc.). Use when you learn a new person/org/project with a strong identifier.
- memory_forget — archive a fact (optionally supersede with a replacement). Rate-limited.
- memory_restore — un-archive a fact you archived by mistake.

Privacy default: memory_remember with no visibility falls back to "private" for user-subject facts. Use visibility:"group" or "public" only when the user signals the fact should be shared.

When the user corrects something, prefer memory_forget with \`replaceWith\` to supersede cleanly (keeps the correction chain auditable).`;

export class MemoryWritePluginNextGen implements IContextPluginNextGen {
  readonly name = 'memory_write';

  private readonly memory: MemorySystem;
  private readonly agentId: string;
  private readonly userId: string;
  private readonly groupId: string | undefined;
  private readonly defaultVisibility: {
    forUser: Visibility;
    forAgent: Visibility;
    forOther: Visibility;
  };
  private readonly autoResolveThreshold: number;
  private readonly getOwnSubjectIds: () => {
    userEntityId?: string;
    agentEntityId?: string;
  };
  private readonly forgetRateLimit: MemoryWritePluginConfig['forgetRateLimit'];

  private readonly estimator: ITokenEstimator = simpleTokenEstimator;
  private instructionsTokenCache: number | null = null;
  private cachedTools: ToolFunction[] | null = null;
  private destroyed = false;

  constructor(config: MemoryWritePluginConfig) {
    if (!config.memory) {
      throw new Error('MemoryWritePluginNextGen requires config.memory (MemorySystem instance)');
    }
    if (!config.agentId) {
      throw new Error('MemoryWritePluginNextGen requires config.agentId');
    }
    if (!config.userId) {
      throw new Error(
        'MemoryWritePluginNextGen requires config.userId — the memory layer ' +
          'enforces an owner invariant on every entity/fact.',
      );
    }
    this.memory = config.memory;
    this.agentId = config.agentId;
    this.userId = config.userId;
    this.groupId = config.groupId;
    this.defaultVisibility = {
      forUser: config.defaultVisibility?.forUser ?? 'private',
      forAgent: config.defaultVisibility?.forAgent ?? 'group',
      forOther: config.defaultVisibility?.forOther ?? 'private',
    };
    this.autoResolveThreshold = config.autoResolveThreshold ?? 0.9;
    this.getOwnSubjectIds = config.getOwnSubjectIds ?? (() => ({}));
    this.forgetRateLimit = config.forgetRateLimit;
  }

  getInstructions(): string | null {
    return WRITE_INSTRUCTIONS;
  }

  async getContent(): Promise<string | null> {
    // Side-effect plugin — no system-message content of its own.
    return null;
  }

  getContents(): unknown {
    return {
      agentId: this.agentId,
      userId: this.userId,
      tools: this.cachedTools?.map((t) => t.definition.function.name) ?? [],
    };
  }

  getTokenSize(): number {
    return 0;
  }

  getInstructionsTokenSize(): number {
    if (this.instructionsTokenCache === null) {
      this.instructionsTokenCache = this.estimator.estimateTokens(WRITE_INSTRUCTIONS);
    }
    return this.instructionsTokenCache;
  }

  isCompactable(): boolean {
    return false;
  }

  async compact(_targetTokensToFree: number): Promise<number> {
    return 0;
  }

  getTools(): ToolFunction[] {
    if (!this.cachedTools) {
      this.cachedTools = createMemoryWriteTools({
        memory: this.memory,
        agentId: this.agentId,
        defaultUserId: this.userId,
        defaultGroupId: this.groupId,
        defaultVisibility: this.defaultVisibility,
        autoResolveThreshold: this.autoResolveThreshold,
        getOwnSubjectIds: this.getOwnSubjectIds,
        forgetRateLimit: this.forgetRateLimit,
      });
    }
    return this.cachedTools;
  }

  destroy(): void {
    this.destroyed = true;
    this.cachedTools = null;
  }

  getState(): unknown {
    return { version: 1, agentId: this.agentId, userId: this.userId };
  }

  restoreState(_state: unknown): void {
    // No mutable state to restore.
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }
}
