/**
 * Shared ownership / contextId checks for write-path tools (remember, link,
 * forget). These helpers centralise the H1 + H2 policies so every tool
 * handles foreign ownership and flaky adapter calls the same way.
 *
 * H1 policy (ownerless-entity writes): When a tool writes against an entity
 * with `ownerId === undefined`, the memory layer derives `fact.ownerId` from
 * the caller's scope. That's correct but opaque — surface it as a warning so
 * the LLM + logs know a facts' ownership is now diverging from the subject's.
 *
 * H2 policy (contextId foreign-check robustness): The original implementation
 * used `Promise.all` — one flaky adapter call rejects the entire tool. Swap
 * for `Promise.allSettled` and fail-safe: on rejection, treat the contextId
 * as foreign (downgrade visibility to private) and emit a warn log. Never
 * crash the tool for a peripheral check.
 */

import type { MemorySystem, ScopeFilter } from '../../memory/index.js';
import { logger } from '../../infrastructure/observability/Logger.js';

/**
 * Returns IDs of contextId entries that either:
 *   - are owned by someone other than the caller, OR
 *   - couldn't be checked (adapter threw) — treated as foreign for safety.
 *
 * This is the guard used by the visibility-downgrade step: if ANY
 * contextId is foreign/unknown, group+public writes are downgraded to
 * private so the fact doesn't leak into a foreign owner's graph-touchesEntity
 * query.
 */
export async function findForeignContextIds(
  memory: MemorySystem,
  contextIds: string[],
  scope: ScopeFilter,
  logContext: Record<string, unknown> = {},
): Promise<string[]> {
  const foreign: string[] = [];
  const results = await Promise.allSettled(
    contextIds.map(async (id) => {
      const ent = await memory.getEntity(id, scope);
      return { id, ent };
    }),
  );
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const id = contextIds[i]!;
    if (r.status === 'rejected') {
      // Adapter blip on one id — don't fail the whole tool. Fail-safe:
      // assume foreign so visibility is downgraded to private.
      logger.warn(
        {
          component: 'memory-tools.findForeignContextIds',
          contextId: id,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          ...logContext,
        },
        'contextId ownership check failed — treating as foreign',
      );
      foreign.push(id);
      continue;
    }
    const ent = r.value.ent;
    if (ent && ent.ownerId !== undefined && ent.ownerId !== scope.userId) {
      foreign.push(id);
    }
  }
  return foreign;
}

/**
 * Build an H1 audit warning when a write targets an ownerless entity. Returns
 * `null` when the subject has a proper ownerId (happy path). The caller
 * appends the warning to the tool result's `warnings[]` so the LLM and logs
 * know the fact's ownerId will diverge from the subject's.
 */
export function ownerlessSubjectWarning(
  subjectOwnerId: string | undefined,
  callerUserId: string | undefined,
): string | null {
  if (subjectOwnerId !== undefined) return null;
  if (!callerUserId) return null; // can't diverge if both are undefined
  return (
    'subject entity has no ownerId — fact will be written with your userId as ' +
    'ownerId, which diverges from the subject. Consider claiming the entity ' +
    `by re-upserting with memory_upsert_entity.`
  );
}
