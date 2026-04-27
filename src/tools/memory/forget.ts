/**
 * memory_forget — archive a fact, optionally superseding it with a replacement.
 * Supersession preserves history (full audit chain); archive hides without
 * a successor.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { MemoryToolDeps, Visibility } from './types.js';
import {
  clampUnit,
  createSlidingWindowLimiter,
  resolveScope,
  toErrorMessage,
  visibilityToPermissions,
} from './types.js';
import { findForeignContextIds } from './ownership.js';

// H9: destructive-op rate limit. Jailbroken prompt + unbounded forget loop =
// silent memory wipe. Default: 10 calls per 60s per user. Caller can disable
// by passing { maxCallsPerWindow: 0 } in plugin config (not recommended).
const FORGET_DEFAULT_MAX = 10;
const FORGET_DEFAULT_WINDOW_MS = 60_000;

export interface ForgetArgs {
  factId: string;
  /**
   * When provided, the archived fact is superseded by a new one with these
   * fields. The new fact inherits the predecessor's subjectId + kind; the
   * predicate / value / details / etc. come from here.
   */
  replaceWith?: {
    predicate?: string;
    value?: unknown;
    objectId?: string;
    details?: string;
    confidence?: number;
    importance?: number;
    observedAt?: string;
    contextIds?: string[];
    visibility?: Visibility;
  };
}

const DESCRIPTION = `Archive a fact, optionally replacing it with a corrected/updated one. Supersession (replaceWith) preserves history — you can always audit what changed. Plain archive just hides the fact.

Behavior rules from \`memory_set_agent_rule\` are facts too: when the user wants a rule **dropped entirely with no replacement** ("never mind the Russian thing", "stop being terse"), pass the \`ruleId\` shown in your system message's "User-specific instructions for this agent" block as \`factId\` here. Use \`memory_set_agent_rule\` with \`replaces\` instead when the user is *swapping* one rule for another (preserves the audit chain on the rule list).

Examples:
- Archive a wrong fact outright: {"factId":"fact_xyz"}
- Drop a behavior rule the user retracted: {"factId":"<ruleId from system message>"}
- Supersede a fact with a correction (subject inherited from predecessor):
  {"factId":"fact_xyz","replaceWith":{"predicate":"role","value":"senior engineer"}}
- Update free-form document:
  {"factId":"fact_note","replaceWith":{"predicate":"learned_pattern","details":"New version of the pattern...","importance":0.8}}`;

export function createForgetTool(deps: MemoryToolDeps): ToolFunction<ForgetArgs> {
  const maxCalls = deps.forgetRateLimit?.maxCallsPerWindow ?? FORGET_DEFAULT_MAX;
  const windowMs = deps.forgetRateLimit?.windowMs ?? FORGET_DEFAULT_WINDOW_MS;
  const checkRate = createSlidingWindowLimiter(maxCalls, windowMs);
  return {
    definition: {
      type: 'function',
      function: {
        name: 'memory_forget',
        description: DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            factId: { type: 'string' },
            replaceWith: { type: 'object' },
          },
          required: ['factId'],
        },
      },
    },

    describeCall: (args) => `forget ${args.factId}${args.replaceWith ? ' (replace)' : ''}`,

    execute: async (args, context) => {
      if (!args.factId || typeof args.factId !== 'string') {
        return { error: 'factId is required (non-empty string)' };
      }
      const scope = resolveScope(context?.userId, deps.defaultUserId, deps.defaultGroupId);

      // H9: rate-limit destructive operations per user. Jailbroken agents can
      // loop tool calls; this caps the blast radius before the host app's
      // circuit breaker / tool-manager safeguards kick in.
      const rate = checkRate(scope.userId ?? '');
      if (!rate.ok) {
        return {
          error:
            `memory_forget rate limit exceeded — at most ${rate.quota} archives ` +
            `per ${Math.round(rate.windowMs / 1000)}s. Retry in ~${Math.ceil(rate.retryAfterMs / 1000)}s. ` +
            `If you need to archive many facts at once, ask the user to confirm first.`,
          rateLimited: true,
          retryAfterMs: rate.retryAfterMs,
        };
      }

      try {
        if (!args.replaceWith) {
          await deps.memory.archiveFact(args.factId, scope);
          return { archived: true, factId: args.factId };
        }

        // Load predecessor to capture subjectId + default permissions before
        // writing the successor.
        const predecessor = await deps.memory.getFact(args.factId, scope);
        if (!predecessor) {
          return { error: `fact '${args.factId}' not found or not visible` };
        }

        const rw = args.replaceWith;
        if (!rw.predicate && !predecessor.predicate) {
          return { error: 'replaceWith.predicate required when predecessor has none' };
        }
        if (rw.value === undefined && !rw.objectId && !rw.details) {
          return {
            error: 'replaceWith needs at least one of: value, objectId, details',
          };
        }

        // H-2: downgrade on foreign contextIds when visibility is non-private.
        // Match remember.ts / link.ts — fire the check whenever visibility is
        // not explicitly `'private'`. Undefined means the new fact will inherit
        // the predecessor's permissions (line below), which could be group- or
        // public-readable, so foreign contextIds would leak. Adapter errors
        // on the check are fail-safe to "foreign".
        const warnings: string[] = [];
        let vis = rw.visibility;
        const effectiveVisBeforeCheck = vis; // may be undefined → inherit predecessor
        if (rw.contextIds?.length && effectiveVisBeforeCheck !== 'private') {
          const foreign = await findForeignContextIds(
            deps.memory,
            rw.contextIds,
            scope,
            { tool: 'memory_forget', predecessorFactId: args.factId },
          );
          if (foreign.length > 0) {
            vis = 'private';
            warnings.push(
              `visibility downgraded to "private": contextIds include entities you don't own or couldn't verify (${foreign.join(', ')}).`,
            );
          }
        }

        const permissions = vis
          ? visibilityToPermissions(vis)
          : predecessor.permissions;
        const observedAt = rw.observedAt ? new Date(rw.observedAt) : new Date();

        const newFact = await deps.memory.addFact(
          {
            subjectId: predecessor.subjectId,
            predicate: rw.predicate ?? predecessor.predicate,
            // M-2: inherit the predecessor's kind so a `document` fact can be
            // cleanly superseded with an updated document body.
            kind: predecessor.kind,
            value: rw.value,
            objectId: rw.objectId,
            details: rw.details,
            confidence: clampUnit(rw.confidence),
            importance: clampUnit(rw.importance),
            contextIds: rw.contextIds,
            observedAt,
            permissions,
            supersedes: args.factId,
          },
          scope,
        );

        const payload: Record<string, unknown> = {
          superseded: true,
          oldFactId: args.factId,
          newFact: {
            id: newFact.id,
            subjectId: newFact.subjectId,
            predicate: newFact.predicate,
            kind: newFact.kind,
            value: newFact.value,
            objectId: newFact.objectId,
            details: newFact.details,
          },
        };
        if (warnings.length > 0) payload.warnings = warnings;
        return payload;
      } catch (err) {
        return { error: `memory_forget failed: ${toErrorMessage(err)}` };
      }
    },
  };
}

