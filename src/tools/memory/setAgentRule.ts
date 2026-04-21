/**
 * memory_set_agent_rule — record a user-specific behavior rule for this agent.
 *
 * Purpose-built, narrow-trigger tool. The main agent is instructed (see
 * `MemoryWritePluginNextGen.WRITE_INSTRUCTIONS`) to call this — and only this —
 * when the user gives a directive about HOW the agent itself should write,
 * speak, format, or behave in future turns.
 *
 * Storage shape:
 *   subjectId:  agentEntityId        (the agent being instructed)
 *   predicate:  'agent_behavior_rule'
 *   details:    <rule text, verbatim>
 *   importance: 0.95                 (rank highly in profile/top-fact selection)
 *   permissions: private             (owner-only; per-user scoping)
 *   supersedes: <replaces?>          (chains corrections through the audit log)
 *
 * Why subject = agent (not user):
 *   The rule is about the agent's behavior. `MemoryPluginNextGen` renders the
 *   "User-specific instructions for this agent" block by querying
 *   `{subjectId: agentEntityId}` in the caller's scope — `ownerId` filtering
 *   via scope ensures each user sees only their own rules. A future rule
 *   inference engine can add facts with any predicate and the same subject
 *   without touching this tool or the renderer.
 *
 * Multi-user note: the memory layer enforces `fact.ownerId == subject.ownerId`.
 * The agent entity bootstrapped by `MemoryPluginNextGen` inherits the ownerId
 * of the caller that first bootstrapped it. In single-user hosts (most deployments
 * today) this is trivially satisfied. Multi-user hosts must either (a) configure
 * `agentEntityPermissions` so each user gets a separate per-user agent entity,
 * or (b) accept that the rule will be rejected for non-owning users. The tool
 * surfaces the rejection as a structured error — it does not silently drop.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { MemoryToolDeps } from './types.js';
import {
  createSlidingWindowLimiter,
  resolveScope,
  toErrorMessage,
  visibilityToPermissions,
} from './types.js';

// Mirror `memory_forget`'s default: 10 writes per 60s per user. A jailbroken
// agent could otherwise spam rules that get rendered into every subsequent
// turn's system message — asymmetric cost (cheap to write, expensive to read
// every turn until superseded). Host can override via `forgetRateLimit` on
// the deps (shared with `memory_forget` — same policy surface).
const SET_RULE_DEFAULT_MAX = 10;
const SET_RULE_DEFAULT_WINDOW_MS = 60_000;

export interface SetAgentRuleArgs {
  rule: string;
  replaces?: string;
}

const DESCRIPTION = `Record a user-specific directive that shapes YOU (this agent) going forward. Call this tool — and ONLY this tool — whenever the user tells you something about HOW YOU SHOULD BEHAVE, IDENTIFY, OR PRESENT YOURSELF in future turns. The test is: does this change something about ME that should persist across turns (tone, format, language, name, persona, role, interaction rules)? If yes, call it. If it's about the user or the world, do not.

**YES — call this:**
- Identity / name / persona: "your name is Jason", "you are a pirate", "act as my therapist", "call yourself Sparky"
- Role assignment: "be my coding copilot", "treat me as a beginner", "you're my sales coach now"
- Tone / style: "be terse", "stop being so formal", "stop apologizing"
- Format rules: "no bullet points", "always cite sources", "reply in JSON"
- Language: "answer in Russian", "always respond in English"
- Meta-interaction: "when you don't know, say so clearly", "ask before running destructive commands"
- Pattern corrections: "you keep suggesting X when I want Y — stop"

**NO — do NOT call this (use a different path):**
- Task requests ("remind me to X") → a task-tracker connector if available, else memory_upsert_entity with type:'task'
- Calendar actions ("schedule Y", "add to my calendar") → a calendar connector
- Factual corrections about the world ("actually it's Tuesday not Monday") → memory_forget with replaceWith on the wrong fact
- User statements about themselves ("I live in Tokyo", "I work at Acme", "my name is Anton") → the background ingestor captures these; do not write yourself
- General preferences about the world ("I like Python") → ambient ingestor

Note the asymmetry: "your name is Jason" is a rule about YOU (call this tool); "my name is Anton" is a fact about the USER (ambient ingestor).

**Supersession.** When the user contradicts a previous rule ("actually be normal again", "drop the Russian thing", "go back to your default name"), pass the prior rule's \`ruleId\` as \`replaces\`. The rule list in your system message shows each rule's \`ruleId\` — use it to point to the right predecessor. This preserves the audit chain. If the user asks to drop a rule entirely with no replacement, use \`memory_forget\` on the ruleId instead.

Params:
- rule: the directive, rephrased in **FIRST PERSON from YOUR perspective**. Do NOT copy the user's second-person phrasing verbatim. The rule will be rendered back into your system message every turn and should read naturally as *self-description*, not as an imperative aimed at someone else.

  | User said | Record as |
  |---|---|
  | "your name is Jason" | "My name is Jason." |
  | "you are a pirate" | "I am a pirate." |
  | "act as my therapist" | "I act as the user's therapist." |
  | "be my coding copilot" | "I am the user's coding copilot." |
  | "be terse" | "I reply tersely." |
  | "stop apologizing" | "I do not apologize." |
  | "no bullet points" | "I do not use bullet points." |
  | "reply in Russian" | "I reply in Russian." |
  | "always cite sources" | "I always cite sources." |

- replaces: optional ruleId (a fact id) of a prior rule the new one overrides.

The rule appears in your system message's "User-specific instructions for this agent" block from the next turn onward, where you will read it as your own persistent context.`;

const BEHAVIOR_RULE_PREDICATE = 'agent_behavior_rule';

export function createSetAgentRuleTool(deps: MemoryToolDeps): ToolFunction<SetAgentRuleArgs> {
  const maxCalls = deps.forgetRateLimit?.maxCallsPerWindow ?? SET_RULE_DEFAULT_MAX;
  const windowMs = deps.forgetRateLimit?.windowMs ?? SET_RULE_DEFAULT_WINDOW_MS;
  const checkRate = createSlidingWindowLimiter(maxCalls, windowMs);
  return {
    definition: {
      type: 'function',
      function: {
        name: 'memory_set_agent_rule',
        description: DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            rule: {
              type: 'string',
              description:
                'The directive, verbatim or lightly cleaned. E.g. "Be terse in replies.", "Reply in Russian.".',
            },
            replaces: {
              type: 'string',
              description:
                'Optional fact id of a prior rule the new one supersedes. Use when the user overrides an existing rule.',
            },
          },
          required: ['rule'],
        },
      },
    },

    describeCall: (args) => `rule: ${String(args.rule ?? '').slice(0, 60)}`,

    execute: async (args, context) => {
      if (!args.rule || typeof args.rule !== 'string' || args.rule.trim().length === 0) {
        return { error: 'rule is required (non-empty string)' };
      }
      const scope = resolveScope(context?.userId, deps.defaultUserId, deps.defaultGroupId);
      const { agentEntityId } = deps.getOwnSubjectIds();
      if (!agentEntityId) {
        return {
          error:
            'memory_set_agent_rule: agent entity not bootstrapped — ensure MemoryPluginNextGen is registered before calling',
        };
      }

      // Rate-limit per user to cap jailbreak blast radius (matches memory_forget).
      const rate = checkRate(scope.userId ?? '');
      if (!rate.ok) {
        return {
          error:
            `memory_set_agent_rule rate limit exceeded — at most ${rate.quota} rules ` +
            `per ${Math.round(rate.windowMs / 1000)}s. Retry in ~${Math.ceil(rate.retryAfterMs / 1000)}s.`,
          rateLimited: true,
          retryAfterMs: rate.retryAfterMs,
        };
      }

      // Ghost-write guard. `MemorySystem.addFact` derives fact.ownerId from
      // the subject entity (not the caller), so a cross-owner write lands
      // stamped with the agent-entity owner's id — effectively injecting a
      // rule into someone else's system message. Reject here, matching the
      // explicit check in memory_remember.
      try {
        const agent = await deps.memory.getEntity(agentEntityId, scope);
        if (!agent) {
          return {
            error:
              'memory_set_agent_rule: agent entity not visible in caller scope (bootstrap desync)',
          };
        }
        if (agent.ownerId !== undefined && agent.ownerId !== scope.userId) {
          return {
            error:
              `memory_set_agent_rule: cannot write behavior rules on an agent entity you don't own ` +
              `(agent.ownerId=${agent.ownerId}, caller=${scope.userId ?? 'none'}). In multi-user ` +
              `deployments configure plugins.memory.agentEntityPermissions so each user bootstraps ` +
              `their own per-user agent entity.`,
            subjectOwnerId: agent.ownerId,
          };
        }
      } catch (err) {
        return { error: `memory_set_agent_rule ownership check failed: ${toErrorMessage(err)}` };
      }

      try {
        const fact = await deps.memory.addFact(
          {
            subjectId: agentEntityId,
            predicate: BEHAVIOR_RULE_PREDICATE,
            kind: 'atomic',
            details: args.rule.trim(),
            confidence: 1.0,
            importance: 0.95,
            permissions: visibilityToPermissions('private'),
            supersedes:
              args.replaces && typeof args.replaces === 'string' ? args.replaces : undefined,
          },
          scope,
        );

        const payload: Record<string, unknown> = {
          ruleId: fact.id,
          rule: args.rule.trim(),
        };
        if (fact.supersedes) payload.superseded = fact.supersedes;
        return payload;
      } catch (err) {
        return { error: `memory_set_agent_rule failed: ${toErrorMessage(err)}` };
      }
    },
  };
}

/** Exported for the render path in `MemoryPluginNextGen` — keeps the predicate
 *  constant in one place so renderer + tool can't drift. */
export const AGENT_BEHAVIOR_RULE_PREDICATE = BEHAVIOR_RULE_PREDICATE;
