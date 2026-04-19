/**
 * PredicateRegistry — the pluggable vocabulary.
 *
 * Holds a set of PredicateDefinitions. Supports canonicalization
 * (camelCase/dash/alias → snake_case), lookup, LLM-prompt rendering, and
 * ranking-weight derivation.
 *
 * Usage patterns:
 *   - `PredicateRegistry.standard()` — ship-with-the-library 51-predicate set.
 *   - `PredicateRegistry.empty().registerAll([...])` — build your own vocab.
 *   - `PredicateRegistry.standard().register(...).register(...)` — extend.
 *
 * The registry is OPTIONAL on MemorySystem. When absent, predicates remain
 * free-form strings.
 */

import type { PredicateDefinition } from './types.js';
import { STANDARD_PREDICATES } from './standard.js';

export class PredicateRegistry {
  private byName = new Map<string, PredicateDefinition>();
  private byAlias = new Map<string, string>();

  /**
   * Returns a fresh registry seeded with the standard 51-predicate set.
   * Called as a factory — each invocation produces an independent instance,
   * so mutations never leak between MemorySystems or tests.
   */
  static standard(): PredicateRegistry {
    const registry = new PredicateRegistry();
    registry.registerAll(STANDARD_PREDICATES);
    return registry;
  }

  /** Returns an empty registry. Use for fully custom vocabularies. */
  static empty(): PredicateRegistry {
    return new PredicateRegistry();
  }

  register(def: PredicateDefinition): this {
    if (def.isAggregate && def.singleValued) {
      throw new Error(
        `PredicateRegistry.register: '${def.name}' cannot be both isAggregate and singleValued`,
      );
    }
    if (this.byName.has(def.name)) {
      throw new Error(`PredicateRegistry.register: duplicate predicate name '${def.name}'`);
    }
    if (this.byAlias.has(def.name)) {
      throw new Error(
        `PredicateRegistry.register: name '${def.name}' collides with existing alias`,
      );
    }
    for (const rawAlias of def.aliases ?? []) {
      const alias = rawAlias.toLowerCase();
      if (this.byName.has(alias)) {
        throw new Error(
          `PredicateRegistry.register: alias '${alias}' of '${def.name}' collides with existing predicate name`,
        );
      }
      if (this.byAlias.has(alias)) {
        throw new Error(
          `PredicateRegistry.register: alias '${alias}' of '${def.name}' already belongs to '${this.byAlias.get(alias)}'`,
        );
      }
    }
    this.byName.set(def.name, def);
    for (const rawAlias of def.aliases ?? []) {
      this.byAlias.set(rawAlias.toLowerCase(), def.name);
    }
    return this;
  }

  registerAll(defs: PredicateDefinition[]): this {
    for (const def of defs) this.register(def);
    return this;
  }

  unregister(name: string): this {
    const def = this.byName.get(name);
    if (!def) return this;
    this.byName.delete(name);
    for (const alias of def.aliases ?? []) {
      this.byAlias.delete(alias.toLowerCase());
    }
    return this;
  }

  /**
   * Resolve an input name (already-canonical, alias, camelCase, or dashed
   * form) to the canonical definition, or null.
   */
  get(nameOrAlias: string): PredicateDefinition | null {
    const canonical = this.canonicalize(nameOrAlias);
    return this.byName.get(canonical) ?? null;
  }

  has(nameOrAlias: string): boolean {
    return this.get(nameOrAlias) !== null;
  }

  /**
   * Normalize an input string to the canonical predicate name.
   *   - 'worksAt' → 'works_at'        (camelCase → snake)
   *   - 'works-at' → 'works_at'       (dash → snake)
   *   - 'Works At' → 'works_at'       (whitespace → snake)
   *   - 'employed_by' → 'works_at'    (alias lookup)
   *   - 'unknown_thing' → 'unknown_thing'  (unchanged — registry is permissive)
   */
  canonicalize(input: string): string {
    const normalized = normalize(input);
    if (this.byName.has(normalized)) return normalized;
    const viaAlias = this.byAlias.get(normalized);
    if (viaAlias) return viaAlias;
    return normalized;
  }

  /** List definitions, optionally filtered by category or subject-type hint. */
  list(filter?: { categories?: string[]; subjectType?: string }): PredicateDefinition[] {
    const all = Array.from(this.byName.values());
    if (!filter) return all;
    return all.filter((def) => {
      if (filter.categories && !filter.categories.includes(def.category)) return false;
      if (
        filter.subjectType &&
        def.subjectTypes &&
        def.subjectTypes.length > 0 &&
        !def.subjectTypes.includes(filter.subjectType)
      ) {
        return false;
      }
      return true;
    });
  }

  categories(): string[] {
    const set = new Set<string>();
    for (const def of this.byName.values()) set.add(def.category);
    return Array.from(set).sort();
  }

  /**
   * Render the registry as a markdown block suitable for injection into an
   * LLM extraction prompt. Chunked by category; capped by `maxPerCategory`
   * to keep the prompt token budget bounded.
   */
  renderForPrompt(opts?: {
    categories?: string[];
    subjectType?: string;
    maxPerCategory?: number;
  }): string {
    const max = opts?.maxPerCategory ?? 5;
    const filter = { categories: opts?.categories, subjectType: opts?.subjectType };
    const defs = this.list(filter);
    if (defs.length === 0) return '';

    const byCategory = new Map<string, PredicateDefinition[]>();
    for (const def of defs) {
      const bucket = byCategory.get(def.category) ?? [];
      bucket.push(def);
      byCategory.set(def.category, bucket);
    }

    const lines: string[] = [];
    lines.push('## Predicate vocabulary');
    lines.push(
      'Use these predicate names where applicable. If none fits, invent a snake_case one.',
    );
    lines.push('');

    const categories = Array.from(byCategory.keys()).sort();
    for (const category of categories) {
      lines.push(`### ${category}`);
      const items = byCategory.get(category)!.slice(0, max);
      for (const def of items) {
        const parts: string[] = [`- \`${def.name}\` — ${def.description}`];
        if (def.inverse) parts.push(`(inverse: \`${def.inverse}\`)`);
        if (def.aliases && def.aliases.length > 0) {
          parts.push(`(aliases: ${def.aliases.map((a) => `\`${a}\``).join(', ')})`);
        }
        lines.push(parts.join(' '));
        if (def.examples && def.examples.length > 0) {
          lines.push(`  e.g. ${def.examples.slice(0, 2).join('; ')}`);
        }
      }
      lines.push('');
    }
    return lines.join('\n').trimEnd();
  }

  /**
   * Produce a new RankingConfig.predicateWeights map merging the registry's
   * weights with the caller-supplied `base`. **`base` wins on collision** so
   * user configuration always trumps the registry default. Returns a NEW
   * object; never mutates inputs.
   */
  toRankingWeights(base?: Record<string, number>): Record<string, number> {
    const merged: Record<string, number> = {};
    for (const def of this.byName.values()) {
      if (typeof def.rankingWeight === 'number') {
        merged[def.name] = def.rankingWeight;
      }
    }
    if (base) {
      for (const [k, v] of Object.entries(base)) merged[k] = v;
    }
    return merged;
  }
}

// ---------------------------------------------------------------------------
// Canonicalization helper
// ---------------------------------------------------------------------------

/**
 * String → snake_case normalizer.
 *   - Lowercases
 *   - Converts - and whitespace runs to _
 *   - Inserts _ between lowercase→uppercase boundaries (camelCase split)
 *   - Collapses repeated _
 *   - Strips leading/trailing _
 */
function normalize(input: string): string {
  if (!input) return '';
  const withCamelSplit = input.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  const lowered = withCamelSplit.toLowerCase();
  const replaced = lowered.replace(/[\s-]+/g, '_');
  const collapsed = replaced.replace(/_+/g, '_');
  return collapsed.replace(/^_+|_+$/g, '');
}
