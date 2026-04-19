/**
 * EntityResolver — translate surface forms ("Microsoft", "Q3 Planning", "John")
 * to existing entity IDs, creating new entities when nothing matches confidently.
 *
 * Matching hierarchy (v1 — typo-tolerant resolution is future work):
 *   1. Strong identifier match (email, domain, …) → confidence 1.0
 *   2. Exact displayName, normalized (case, "Inc.", punctuation) → confidence 0.90
 *   3. Exact alias, normalized → confidence 0.85
 *
 * Typos and fuzzy matches do NOT currently resolve. A misspelled "Microsft"
 * will create a duplicate entity rather than merging with "Microsoft". This
 * is intentional for v1: the only deterministic fuzzy approach is an O(n)
 * scan of entities-of-type, which silently produces wrong answers at scale.
 *
 * The proper solution is an entity-level semantic search (cosine over
 * `identityEmbedding` via Atlas Vector Search / ANN index). That requires a
 * new `IMemoryStore.semanticSearchEntities` capability on adapters and is
 * planned for a later release. Identity embeddings ARE populated today
 * (`enableIdentityEmbedding` default true) so switching on semantic tier
 * later is a drop-in change.
 *
 * Context-aware disambiguation: when multiple candidates pass threshold,
 * prefer the one that shares the most `contextEntityIds` with already-
 * resolved mentions in the same signal.
 *
 * Alias accumulation: `upsertBySurface` records the incoming surface + any
 * supplied identifiers on the matched entity, so the system gets better with
 * use — future mentions of the same surface hit the exact-alias match.
 */

import type {
  EntityCandidate,
  EntityId,
  EntityResolutionConfig,
  IEntity,
  IMemoryStore,
  Identifier,
  ResolveEntityOptions,
  ResolveEntityQuery,
  ScopeFilter,
  UpsertBySurfaceInput,
  UpsertBySurfaceOptions,
  UpsertBySurfaceResult,
} from '../types.js';
import { normalizeSurface } from './fuzzy.js';

const DEFAULT_AUTO_RESOLVE_THRESHOLD = 0.9;
const DEFAULT_THRESHOLD = 0.5;
const DEFAULT_LIMIT = 5;

/**
 * Narrow hook used by EntityResolver — lets it query + upsert without pulling
 * in the full MemorySystem surface (keeps the resolver easy to test).
 */
export interface ResolverMemoryHooks {
  store: IMemoryStore;
  embedQuery?: (text: string) => Promise<number[]>;
  upsertEntity: (
    input: Partial<IEntity> & {
      identifiers: Identifier[];
      displayName: string;
      type: string;
    },
    scope: ScopeFilter,
  ) => Promise<{ entity: IEntity; created: boolean }>;
  /** Patches an existing entity with additional aliases/identifiers (no-op if already present). */
  appendAliasesAndIdentifiers: (
    id: EntityId,
    aliases: string[],
    identifiers: Identifier[],
    scope: ScopeFilter,
  ) => Promise<IEntity>;
}

export class EntityResolver {
  private readonly autoResolveThreshold: number;

  constructor(
    private readonly hooks: ResolverMemoryHooks,
    config?: EntityResolutionConfig,
  ) {
    this.autoResolveThreshold = config?.autoResolveThreshold ?? DEFAULT_AUTO_RESOLVE_THRESHOLD;
  }

  /**
   * Find candidate entities for a surface form. Returns ranked by confidence.
   * Empty array if nothing clears `opts.threshold` (default 0.5).
   */
  async resolve(
    query: ResolveEntityQuery,
    scope: ScopeFilter,
    opts?: ResolveEntityOptions,
  ): Promise<EntityCandidate[]> {
    const threshold = opts?.threshold ?? DEFAULT_THRESHOLD;
    const limit = opts?.limit ?? DEFAULT_LIMIT;
    const seen = new Map<EntityId, EntityCandidate>();

    // ---- Tier 1: strong identifier match ----
    if (query.identifiers && query.identifiers.length > 0) {
      for (const ident of query.identifiers) {
        const matches = await this.hooks.store.findEntitiesByIdentifier(
          ident.kind,
          ident.value,
          scope,
        );
        for (const entity of matches) {
          if (query.type && entity.type !== query.type) continue;
          const existing = seen.get(entity.id);
          const candidate: EntityCandidate = {
            entity,
            confidence: 1.0,
            matchedOn: 'identifier',
          };
          if (!existing || existing.confidence < candidate.confidence) {
            seen.set(entity.id, candidate);
          }
        }
      }
    }

    // ---- Tier 2 + 3: exact displayName + alias match ----
    // searchEntities substring-matches; we then re-check with normalized
    // equality to distinguish exact matches from mere substring hits.
    //
    // We search both the raw surface AND the normalized surface so that
    // forms like "Microsoft Inc." (which substring-misses "Microsoft") still
    // find the entity — normalizeSurface strips corporate suffixes, so the
    // normalized query becomes "microsoft" and the underlying case-insensitive
    // substring index hits.
    const surface = query.surface.trim();
    if (surface.length > 0) {
      const normalized = normalizeSurface(surface);
      const seenPages = new Set<string>();
      const queries = normalized && normalized !== surface.toLowerCase()
        ? [surface, normalized]
        : [surface];

      for (const q of queries) {
        const page = await this.hooks.store.searchEntities(
          q,
          { types: query.type ? [query.type] : undefined, limit: 50 },
          scope,
        );
        for (const entity of page.items) {
          if (seenPages.has(entity.id)) continue;
          seenPages.add(entity.id);
          const tier = exactMatchTier(entity, surface);
          if (tier === null) continue;
          const candidate: EntityCandidate = {
            entity,
            confidence: tier.confidence,
            matchedOn: tier.matchedOn,
          };
          const existing = seen.get(entity.id);
          if (!existing || existing.confidence < candidate.confidence) {
            seen.set(entity.id, candidate);
          }
        }
      }
    }

    // Typo-tolerant (fuzzy / semantic) resolution intentionally omitted in v1.
    // See file header comment.

    // ---- Context-aware disambiguation ----
    if (query.contextEntityIds && query.contextEntityIds.length > 0 && seen.size > 1) {
      const contextSet = new Set(query.contextEntityIds);
      const topConfidence = Math.max(...[...seen.values()].map((c) => c.confidence));
      if (topConfidence < 1.0) {
        // Only disambiguate when top is not already a perfect identifier match.
        // Boost candidates with context-proximity by re-fetching their outbound
        // connections and counting overlaps with contextEntityIds.
        for (const candidate of seen.values()) {
          const facts = await this.hooks.store.findFacts(
            { touchesEntity: candidate.entity.id },
            { limit: 50 },
            scope,
          );
          let overlap = 0;
          for (const f of facts.items) {
            if (contextSet.has(f.subjectId)) overlap++;
            if (f.objectId && contextSet.has(f.objectId)) overlap++;
            if (f.contextIds) {
              for (const cid of f.contextIds) if (contextSet.has(cid)) overlap++;
            }
          }
          if (overlap > 0) {
            candidate.confidence = Math.min(1.0, candidate.confidence + overlap * 0.05);
          }
        }
      }
    }

    return [...seen.values()]
      .filter((c) => c.confidence >= threshold)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  /**
   * Upsert-or-resolve: resolves the surface to an existing entity if top
   * candidate clears autoResolveThreshold, else creates a new entity.
   * Accumulates aliases + identifiers on matches — the system gets better
   * at recognizing the same entity across variant surface forms over time.
   */
  async upsertBySurface(
    input: UpsertBySurfaceInput,
    scope: ScopeFilter,
    opts?: UpsertBySurfaceOptions,
  ): Promise<UpsertBySurfaceResult> {
    const threshold = opts?.autoResolveThreshold ?? this.autoResolveThreshold;
    const candidates = await this.resolve(
      {
        surface: input.surface,
        type: input.type,
        identifiers: input.identifiers,
        contextEntityIds: input.contextEntityIds,
      },
      scope,
      { limit: 5, threshold: 0.5 },
    );

    const top = candidates[0];
    if (top && top.confidence >= threshold) {
      // Accumulate new aliases + identifiers on the matched entity.
      const newAliases = [input.surface, ...(input.aliases ?? [])];
      const entity = await this.hooks.appendAliasesAndIdentifiers(
        top.entity.id,
        newAliases,
        input.identifiers ?? [],
        scope,
      );
      const mergeCandidates = candidates.slice(1);
      return { entity, resolved: true, mergeCandidates };
    }

    // Create new entity.
    const { entity } = await this.hooks.upsertEntity(
      {
        type: input.type,
        displayName: input.surface,
        aliases: input.aliases,
        identifiers: input.identifiers ?? [],
      },
      scope,
    );
    return { entity, resolved: false, mergeCandidates: candidates };
  }
}

// =============================================================================
// Private helpers
// =============================================================================

function exactMatchTier(
  entity: IEntity,
  surface: string,
): { confidence: number; matchedOn: 'displayName' | 'alias' } | null {
  const normSurface = normalizeSurface(surface);
  if (!normSurface) return null;
  if (normalizeSurface(entity.displayName) === normSurface) {
    return { confidence: 0.9, matchedOn: 'displayName' };
  }
  if (entity.aliases) {
    for (const a of entity.aliases) {
      if (normalizeSurface(a) === normSurface) {
        return { confidence: 0.85, matchedOn: 'alias' };
      }
    }
  }
  return null;
}

/**
 * Short string embedded for identity matching. Composed of displayName,
 * top aliases, and primary identifier values. Populated on every entity
 * write when an embedder is configured; consumed by the future entity-level
 * semantic search tier (not yet wired — see file header).
 */
export function buildIdentityString(args: {
  type: string;
  displayName: string;
  aliases: string[];
  identifiers: Identifier[];
}): string {
  const primaryIds = args.identifiers
    .filter((i) => i.isPrimary)
    .slice(0, 3)
    .map((i) => `${i.kind}:${i.value}`);
  const otherIds = args.identifiers
    .filter((i) => !i.isPrimary)
    .slice(0, 2)
    .map((i) => `${i.kind}:${i.value}`);
  const allIds = [...primaryIds, ...otherIds].slice(0, 3);
  const aliasStr = args.aliases.slice(0, 3).join(', ');
  return `${args.type}: ${args.displayName}${aliasStr ? ' | aliases: ' + aliasStr : ''}${
    allIds.length > 0 ? ' | ids: ' + allIds.join(', ') : ''
  }`;
}

// Re-export defaults so MemorySystem can keep consistent thresholds.
export const RESOLUTION_DEFAULTS = {
  autoResolveThreshold: DEFAULT_AUTO_RESOLVE_THRESHOLD,
  threshold: DEFAULT_THRESHOLD,
  limit: DEFAULT_LIMIT,
} as const;
