/**
 * SubjectRef → entity resolver.
 *
 * Shared by every memory tool. Returns a structured result so tools can
 * report ambiguity as candidates (recoverable by the LLM) rather than
 * throwing a generic error.
 */

import type {
  EntityCandidate,
  MemorySystem,
  ScopeFilter,
} from '../../memory/index.js';
import {
  SUBJECT_TOKEN_ME,
  SUBJECT_TOKEN_THIS_AGENT,
  type ResolveResult,
  type SubjectRef,
} from './types.js';

export interface ResolveSubjectArgs {
  memory: MemorySystem;
  /** Bootstrapped entity ids — used to resolve the "me" / "this_agent" tokens. */
  getOwnSubjectIds: () => { userEntityId?: string; agentEntityId?: string };
  /** Fuzzy-match threshold for `{surface}` lookups. */
  autoResolveThreshold?: number;
}

/**
 * Factory: creates a resolver function closed over a specific memory system
 * and plugin. The returned function takes a SubjectRef + scope and yields a
 * ResolveResult.
 */
export function createSubjectResolver(
  args: ResolveSubjectArgs,
): (subject: SubjectRef, scope: ScopeFilter) => Promise<ResolveResult> {
  const { memory, getOwnSubjectIds, autoResolveThreshold = 0.9 } = args;

  async function byId(id: string, scope: ScopeFilter): Promise<ResolveResult> {
    const entity = await memory.getEntity(id, scope);
    if (!entity) {
      return {
        ok: false,
        reason: 'not_found',
        message: `No entity with id '${id}' visible to the caller.`,
      };
    }
    return { ok: true, entity };
  }

  async function byIdentifier(
    kind: string,
    value: string,
    scope: ScopeFilter,
  ): Promise<ResolveResult> {
    // Exact identifier hit — use a tight threshold so non-identifier
    // lookups (surface fuzz) can't bleed in.
    const candidates = await memory.resolveEntity(
      { surface: value, identifiers: [{ kind, value }] },
      scope,
      { limit: 5 },
    );
    const exact = candidates.find(
      (c) => c.entity.identifiers.some((i) => i.kind === kind && i.value === value),
    );
    if (!exact) {
      return {
        ok: false,
        reason: 'not_found',
        message: `No entity with identifier ${kind}=${value}.`,
        candidates: shapeCandidates(candidates),
      };
    }
    return { ok: true, entity: exact.entity };
  }

  async function bySurface(surface: string, scope: ScopeFilter): Promise<ResolveResult> {
    const trimmed = surface.trim();
    if (trimmed.length === 0) {
      return {
        ok: false,
        reason: 'not_found',
        message: 'Empty surface — provide a name/alias to search for.',
      };
    }
    const candidates = await memory.resolveEntity(
      { surface: trimmed },
      scope,
      { limit: 5 },
    );
    if (candidates.length === 0) {
      return {
        ok: false,
        reason: 'not_found',
        message: `No entity matching surface='${trimmed}'.`,
      };
    }
    const top = candidates[0]!;
    if (top.confidence >= autoResolveThreshold) {
      return { ok: true, entity: top.entity };
    }
    return {
      ok: false,
      reason: 'ambiguous',
      message:
        `Surface '${trimmed}' has ${candidates.length} candidate(s), ` +
        `top confidence ${top.confidence.toFixed(2)} is below the auto-resolve ` +
        `threshold ${autoResolveThreshold.toFixed(2)}. Pick one by id.`,
      candidates: shapeCandidates(candidates),
    };
  }

  return async function resolve(subject, scope) {
    // String form — may be a token or a raw id.
    if (typeof subject === 'string') {
      if (subject === SUBJECT_TOKEN_ME) {
        const { userEntityId } = getOwnSubjectIds();
        if (!userEntityId) {
          return {
            ok: false,
            reason: 'no_user_scope',
            message: '"me" requires a user scope — plugin has no userId configured.',
          };
        }
        return byId(userEntityId, scope);
      }
      if (subject === SUBJECT_TOKEN_THIS_AGENT) {
        const { agentEntityId } = getOwnSubjectIds();
        if (!agentEntityId) {
          return {
            ok: false,
            reason: 'not_found',
            message: '"this_agent" unavailable — agent entity not bootstrapped yet.',
          };
        }
        return byId(agentEntityId, scope);
      }
      return byId(subject, scope);
    }

    if (typeof subject === 'object' && subject !== null) {
      if ('id' in subject) return byId(subject.id, scope);
      if ('identifier' in subject) {
        const { kind, value } = subject.identifier;
        return byIdentifier(kind, value, scope);
      }
      if ('surface' in subject) return bySurface(subject.surface, scope);
    }

    return {
      ok: false,
      reason: 'not_found',
      message:
        'Unrecognised SubjectRef shape. Use an entity id, "me", "this_agent", ' +
        '{id}, {identifier:{kind,value}}, or {surface}.',
    };
  };
}

function shapeCandidates(
  candidates: EntityCandidate[],
): Array<{ id: string; displayName: string; score?: number }> {
  // `score` in the tool surface maps to `confidence` in the resolver —
  // renamed for LLM-friendliness.
  return candidates.map((c) => ({
    id: c.entity.id,
    displayName: c.entity.displayName,
    score: c.confidence,
  }));
}
