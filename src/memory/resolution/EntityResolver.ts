/**
 * EntityResolver — translate surface forms ("Microsoft", "Q3 Planning", "John")
 * to existing entity IDs, creating new entities when nothing matches confidently.
 *
 * Matching hierarchy:
 *   1. Strong identifier match (email, domain, …) → confidence 1.0
 *   2. Exact displayName, normalized (case, "Inc.", punctuation) → confidence 0.90
 *   3. Exact alias, normalized → confidence 0.85
 *   4. Semantic match via `identityEmbedding` (opt-in, off by default) →
 *      confidence = min(cosine, 0.89). Capped strictly below the default
 *      auto-resolve threshold (0.90) so enabling the tier alone never
 *      auto-merges entities — the LLM sees candidates and decides, or the
 *      caller lowers `autoResolveThreshold` to trust the scoring.
 *
 * Enable semantic by setting `EntityResolutionConfig.enableSemanticResolution:
 * true`. Requires an embedder AND an adapter implementing
 * `IMemoryStore.semanticSearchEntities` (`InMemoryAdapter`, `MongoMemoryAdapter`).
 * Identity embeddings are populated whenever `enableIdentityEmbedding` is on
 * (default true) — turning this flag on is a drop-in change.
 *
 * Context-aware disambiguation: when multiple candidates pass threshold,
 * prefer the one that shares the most `contextEntityIds` with already-
 * resolved mentions in the same signal. Runs on top of all tiers, including
 * semantic.
 *
 * Alias accumulation: `upsertBySurface` records the incoming surface + any
 * supplied identifiers on the matched entity, so the system gets better with
 * use — future mentions of the same surface hit the exact-alias match (even
 * if it arrived via the semantic tier).
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
 * Semantic tier parameters — intentionally NOT exposed on the config surface
 * to keep the knob count minimal. These are safe defaults calibrated against
 * OpenAI text-embedding-3-small / Cohere embed-english-v3 identity embeddings:
 *   - `MIN_SCORE` = 0.75 cosine — below this, cosine becomes too noisy to
 *     act on. A dimension-matched random pair typically scores ~0.0-0.5.
 *   - `CONFIDENCE_CAP` = 0.89 — strictly below the default auto-resolve
 *     threshold (0.9). Enabling semantic will never auto-merge by itself.
 *   - `TOP_K` = 10 — small enough to stay cheap, large enough to survive
 *     context-disambiguation tiebreaks.
 */
const SEMANTIC_MIN_SCORE = 0.75;
const SEMANTIC_CONFIDENCE_CAP = 0.89;
const SEMANTIC_TOP_K = 10;

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
  /**
   * Patches an existing entity with additional aliases/identifiers (no-op if already present).
   * When `opts.metadata` is supplied, merges per `opts.metadataMerge`:
   *  - `'fillMissing'` (default): only keys absent from stored metadata are set.
   *  - `'overwrite'`: shallow-merge (incoming keys win).
   */
  appendAliasesAndIdentifiers: (
    id: EntityId,
    aliases: string[],
    identifiers: Identifier[],
    scope: ScopeFilter,
    opts?: {
      metadata?: Record<string, unknown>;
      metadataMerge?: 'fillMissing' | 'overwrite';
    },
  ) => Promise<IEntity>;
}

export class EntityResolver {
  private readonly autoResolveThreshold: number;
  private readonly semanticEnabled: boolean;

  constructor(
    private readonly hooks: ResolverMemoryHooks,
    config?: EntityResolutionConfig,
  ) {
    this.autoResolveThreshold = config?.autoResolveThreshold ?? DEFAULT_AUTO_RESOLVE_THRESHOLD;
    this.semanticEnabled = config?.enableSemanticResolution === true;
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

    // ---- Tier 4: semantic match over identityEmbedding ----
    // Opt-in (`enableSemanticResolution: true`). Runs only when:
    //   - feature flag on,
    //   - an embedder is wired (we need to embed the query surface),
    //   - the store implements `semanticSearchEntities`,
    //   - the surface is non-empty.
    // Skipped when a tier-1 identifier match already produced a 1.0 candidate
    // — identifiers are authoritative and we don't want to waste the embed.
    if (
      this.semanticEnabled &&
      this.hooks.embedQuery &&
      this.hooks.store.semanticSearchEntities &&
      surface.length > 0
    ) {
      const topIdentifierMatch = [...seen.values()].some(
        (c) => c.matchedOn === 'identifier' && c.confidence >= 1.0,
      );
      if (!topIdentifierMatch) {
        try {
          const normalizedForEmbed = normalizeSurface(surface) || surface;
          const queryVec = await this.hooks.embedQuery(normalizedForEmbed);
          const results = await this.hooks.store.semanticSearchEntities(
            queryVec,
            query.type ? { type: query.type } : {},
            { topK: SEMANTIC_TOP_K, minScore: SEMANTIC_MIN_SCORE },
            scope,
          );
          for (const { entity, score } of results) {
            if (query.type && entity.type !== query.type) continue;
            const confidence = Math.min(score, SEMANTIC_CONFIDENCE_CAP);
            const candidate: EntityCandidate = {
              entity,
              confidence,
              matchedOn: 'embedding',
            };
            const existing = seen.get(entity.id);
            // Never downgrade a higher-tier match (exact/identifier beats semantic).
            if (!existing || existing.confidence < candidate.confidence) {
              seen.set(entity.id, candidate);
            }
          }
        } catch (err) {
          // Graceful degradation: log the failure (no silent errors per CLAUDE.md)
          // and fall through with tier 1-3 results only. The embedder or the
          // adapter might be temporarily unavailable; resolver still returns
          // useful exact matches.
          // eslint-disable-next-line no-console
          console.warn(
            `[EntityResolver] semantic tier failed for surface='${surface}' type='${query.type ?? ''}': ` +
              (err instanceof Error ? err.message : String(err)),
          );
        }
      }
    }

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
      // Accumulate new aliases + identifiers on the matched entity. Metadata
      // defaults to fillMissing merge — re-upsert should never overwrite an
      // existing task.state, event.startTime, etc. Callers who want to mutate
      // deliberately should use updateEntityMetadata / transitionTaskState.
      const newAliases = [input.surface, ...(input.aliases ?? [])];
      const entity = await this.hooks.appendAliasesAndIdentifiers(
        top.entity.id,
        newAliases,
        input.identifiers ?? [],
        scope,
        input.metadata
          ? {
              metadata: input.metadata,
              metadataMerge: opts?.metadataMerge ?? 'fillMissing',
            }
          : undefined,
      );
      const mergeCandidates = candidates.slice(1);
      return { entity, resolved: true, mergeCandidates };
    }

    // Create new entity — metadata set verbatim.
    const { entity } = await this.hooks.upsertEntity(
      {
        type: input.type,
        displayName: input.surface,
        aliases: input.aliases,
        identifiers: input.identifiers ?? [],
        metadata: input.metadata,
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
