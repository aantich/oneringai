/**
 * UserPermissionRulesEngine - Evaluates per-user permission rules.
 *
 * User rules have the HIGHEST priority — they override ALL built-in policies.
 * Resolution uses specificity-based matching (not numeric priorities):
 *
 * 1. Unconditional rules are checked first — if matched, they are FINAL
 *    (no more specific rule can override them)
 * 2. Conditional rules are evaluated by specificity — rules with MORE
 *    matching conditions win over rules with fewer conditions
 * 3. Blanket rules (no conditions) are the fallback
 * 4. Ties: most recently updated rule wins
 *
 * This ensures:
 * - "bash → allow (unconditional)" means ALL bash allowed, period
 * - "bash → allow" + "bash + rm -rf → ask" means rm -rf asks, rest allowed
 * - No priority numbers needed — specificity is implicit
 */

import type {
  UserPermissionRule,
  ArgumentCondition,
  UserRuleEvalResult,
  PolicyContext,
} from './types.js';
import type { IUserPermissionRulesStorage } from '../../domain/interfaces/IUserPermissionRulesStorage.js';

// Virtual arg prefixes for matching against context metadata
const META_ARG_MAP: Record<string, keyof PolicyContext> = {
  '__toolCategory': 'toolCategory',
  '__toolSource': 'toolSource',
  '__toolNamespace': 'toolNamespace',
};

export class UserPermissionRulesEngine {
  private rules: UserPermissionRule[] = [];
  private storage?: IUserPermissionRulesStorage | null;
  private _loaded = false;
  private _destroyed = false;

  /** Index: toolName → rules for O(1) lookup. Wildcard '*' rules stored under '*'. */
  private ruleIndex = new Map<string, UserPermissionRule[]>();

  constructor(storage?: IUserPermissionRulesStorage) {
    this.storage = storage;
  }

  // ==========================================================================
  // Evaluation
  // ==========================================================================

  /**
   * Evaluate user rules against a tool call.
   *
   * Returns the matching result, or null if no rule matches (fall through to chain).
   */
  evaluate(context: PolicyContext): UserRuleEvalResult | null {
    // Clean expired rules (lazy)
    this.cleanExpired();

    // Collect all candidate rules for this tool using index (O(1) lookup)
    const toolRules = this.ruleIndex.get(context.toolName) ?? [];
    const wildcardRules = this.ruleIndex.get('*') ?? [];
    const candidates = [...toolRules, ...wildcardRules].filter((r) => r.enabled);

    if (candidates.length === 0) return null;

    // 1. Check unconditional rules first — they are absolute
    // Single pass: check conditions if present, blanket if absent
    for (const rule of candidates) {
      if (!rule.unconditional) continue;

      if (this.matchesConditions(rule, context)) {
        const isBlanket = !rule.conditions || rule.conditions.length === 0;
        return {
          action: rule.action,
          rule,
          reason: `User rule (unconditional${isBlanket ? ', blanket' : ''}): ${rule.description ?? rule.id}`,
        };
      }
    }

    // 2. Evaluate conditional rules by specificity
    // Collect all rules whose conditions match
    interface MatchedRule {
      rule: UserPermissionRule;
      specificity: number; // number of matching conditions
    }

    const matched: MatchedRule[] = [];

    for (const rule of candidates) {
      if (rule.unconditional) continue; // already handled

      if (!rule.conditions || rule.conditions.length === 0) {
        // Blanket rule — specificity 0
        matched.push({ rule, specificity: 0 });
      } else if (this.matchesConditions(rule, context)) {
        // Conditional rule — specificity = number of conditions
        matched.push({ rule, specificity: rule.conditions.length });
      }
      // If conditions don't match, rule is skipped entirely
    }

    if (matched.length === 0) return null;

    // Sort by specificity (higher first), then by updatedAt (more recent first)
    matched.sort((a, b) => {
      if (a.specificity !== b.specificity) return b.specificity - a.specificity;
      // Tie: most recently updated wins
      return new Date(b.rule.updatedAt).getTime() - new Date(a.rule.updatedAt).getTime();
    });

    const winner = matched[0]!;
    return {
      action: winner.rule.action,
      rule: winner.rule,
      reason: winner.specificity > 0
        ? `User rule (${winner.specificity} conditions matched): ${winner.rule.description ?? winner.rule.id}`
        : `User rule (blanket): ${winner.rule.description ?? winner.rule.id}`,
    };
  }

  // ==========================================================================
  // Condition Matching
  // ==========================================================================

  /**
   * Check if ALL conditions of a rule match the context (AND logic).
   */
  private matchesConditions(rule: UserPermissionRule, context: PolicyContext): boolean {
    if (!rule.conditions || rule.conditions.length === 0) return true;
    return rule.conditions.every((c) => this.matchesCondition(c, context));
  }

  /**
   * Check if a single condition matches.
   */
  private matchesCondition(condition: ArgumentCondition, context: PolicyContext): boolean {
    // Resolve the value to check
    let rawValue: unknown;

    if (condition.argName in META_ARG_MAP) {
      // Meta-arg: resolve from context metadata
      const key = META_ARG_MAP[condition.argName]!;
      rawValue = context[key];
    } else {
      // Real arg: from tool call args
      rawValue = context.args[condition.argName];
    }

    // Convert to string for comparison
    const value = rawValue != null ? String(rawValue) : '';
    const ignoreCase = condition.ignoreCase !== false; // default true

    const compareValue = ignoreCase ? condition.value.toLowerCase() : condition.value;
    const testValue = ignoreCase ? value.toLowerCase() : value;

    switch (condition.operator) {
      case 'starts_with':
        return testValue.startsWith(compareValue);
      case 'not_starts_with':
        return !testValue.startsWith(compareValue);
      case 'contains':
        return testValue.includes(compareValue);
      case 'not_contains':
        return !testValue.includes(compareValue);
      case 'equals':
        return testValue === compareValue;
      case 'not_equals':
        return testValue !== compareValue;
      case 'matches': {
        try {
          const flags = ignoreCase ? 'i' : '';
          return new RegExp(condition.value, flags).test(value);
        } catch {
          return false; // Invalid regex
        }
      }
      case 'not_matches': {
        try {
          const flags = ignoreCase ? 'i' : '';
          return !new RegExp(condition.value, flags).test(value);
        } catch {
          return true; // Invalid regex — treat as "not matching"
        }
      }
      default:
        return false;
    }
  }

  // ==========================================================================
  // CRUD
  // ==========================================================================

  /**
   * Add a new rule. Auto-saves if storage is configured.
   */
  async addRule(rule: UserPermissionRule, userId?: string): Promise<void> {
    // Remove existing rule with same ID if present
    this.rules = this.rules.filter((r) => r.id !== rule.id);
    this.rules.push(rule);
    this.rebuildIndex();
    await this.save(userId);
  }

  /**
   * Update an existing rule. Auto-saves if storage is configured.
   */
  async updateRule(ruleId: string, updates: Partial<UserPermissionRule>, userId?: string): Promise<boolean> {
    const idx = this.rules.findIndex((r) => r.id === ruleId);
    if (idx === -1) return false;

    this.rules[idx] = {
      ...this.rules[idx]!,
      ...updates,
      id: ruleId, // prevent ID change
      updatedAt: new Date().toISOString(),
    };

    this.rebuildIndex();
    await this.save(userId);
    return true;
  }

  /**
   * Remove a rule by ID. Auto-saves if storage is configured.
   */
  async removeRule(ruleId: string, userId?: string): Promise<boolean> {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.id !== ruleId);
    if (this.rules.length === before) return false;
    this.rebuildIndex();
    await this.save(userId);
    return true;
  }

  /**
   * Get a rule by ID.
   */
  getRule(ruleId: string): UserPermissionRule | null {
    return this.rules.find((r) => r.id === ruleId) ?? null;
  }

  /**
   * Get all rules.
   */
  getRules(): UserPermissionRule[] {
    return [...this.rules];
  }

  /**
   * Get all rules for a specific tool.
   */
  getRulesForTool(toolName: string): UserPermissionRule[] {
    return this.rules.filter((r) => r.toolName === toolName || r.toolName === '*');
  }

  /**
   * Enable a rule.
   */
  async enableRule(ruleId: string, userId?: string): Promise<boolean> {
    return this.updateRule(ruleId, { enabled: true }, userId);
  }

  /**
   * Disable a rule.
   */
  async disableRule(ruleId: string, userId?: string): Promise<boolean> {
    return this.updateRule(ruleId, { enabled: false }, userId);
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Load rules from storage.
   */
  async load(userId?: string): Promise<void> {
    if (!this.storage) {
      this._loaded = true;
      return;
    }

    const loaded = await this.storage.load(userId);
    if (loaded) {
      this.rules = loaded;
      // Clean expired rules on load to prevent storage growth
      if (this.cleanExpired()) {
        // Persist cleanup (fire-and-forget — non-critical)
        this.storage.save(userId, this.rules).catch(() => {});
      }
      this.rebuildIndex();
    }
    this._loaded = true;
  }

  /**
   * Save current rules to storage.
   */
  async save(userId?: string): Promise<void> {
    if (!this.storage) return;
    // Clean expired before saving to prevent storage growth
    this.cleanExpired();
    await this.storage.save(userId, this.rules);
  }

  /**
   * Whether rules have been loaded from storage.
   */
  get isLoaded(): boolean {
    return this._loaded;
  }

  /**
   * Set the storage backend.
   */
  setStorage(storage: IUserPermissionRulesStorage): void {
    this.storage = storage;
  }

  // ==========================================================================
  // IDisposable
  // ==========================================================================

  get isDestroyed(): boolean {
    return this._destroyed;
  }

  /**
   * Destroy the engine, clearing all rules and releasing storage reference.
   */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this.rules = [];
    this.ruleIndex.clear();
    this.storage = null;
  }

  // ==========================================================================
  // Internal
  // ==========================================================================

  /**
   * Remove expired rules (lazy cleanup).
   * @returns true if any rules were removed (for save optimization).
   */
  private cleanExpired(): boolean {
    const now = new Date().toISOString();
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => {
      if (!r.expiresAt) return true;
      return r.expiresAt > now;
    });
    const removed = this.rules.length < before;
    if (removed) {
      this.rebuildIndex();
    }
    return removed;
  }

  /**
   * Rebuild the toolName → rules index for O(1) lookup.
   */
  private rebuildIndex(): void {
    this.ruleIndex.clear();
    for (const rule of this.rules) {
      const existing = this.ruleIndex.get(rule.toolName);
      if (existing) {
        existing.push(rule);
      } else {
        this.ruleIndex.set(rule.toolName, [rule]);
      }
    }
  }
}
