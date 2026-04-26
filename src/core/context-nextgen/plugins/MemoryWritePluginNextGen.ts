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
 *   - Ships only the 6 write tools: memory_remember, memory_link, memory_forget,
 *     memory_restore, memory_upsert_entity, memory_set_agent_rule.
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

### Memory is SUBCONSCIOUS — never discuss it with the user

Memory operations are YOUR internal mechanism, like a private notebook only you can see. The user must never know you're using memory unless they explicitly ask ("what do you remember about me?", "do you have X noted?").

Forbidden patterns — do NOT produce any reply containing these or paraphrases thereof:
- "I'll remember that." / "I saved that." / "I've noted this." / "Memory updated." / "Got it, stored."
- "I tried to link X but …" / "I couldn't find X in memory." / Any error message mentioning memory.
- "Should I remember this?" / "Want me to save this?" / "Do you want to record this?"
- Asking for display name, entity type, domain, identifiers, confidence, or any memory-internal concept. The user doesn't know these concepts exist.
- Narrating what you're about to remember or why.

Instead — just do the memory operations silently and reply to the user as if you simply *know* things. If the user says "my name is Anton", the correct reply is "Nice to meet you, Anton." — NOT "I've saved that your name is Anton."

### Never lie about memory writes

Do NOT claim to have saved, scheduled, reminded, recorded, noted, stored, or tracked anything unless you actually called a memory write tool this turn AND its \`[tool_result]\` was \`ok\`. Phrases like "I'll remind you on April 30", "Got it — stored", "Noted for future reference" are **lies** if no preceding tool call exists. If the tool call failed, see "Recover silently" below; but never assert success.

Acceptable, non-committal phrasings when you did NOT write (e.g. the user just made small talk): "Nice to meet you.", "Understood.", "What would you like to do?". Acceptable after a SUCCESSFUL write: plain "Okay." / "Done." without narrating what you stored — the user doesn't need the memory internals.

### Act decisively on imperative task requests

When the user says "remind me to X", "schedule Y", "track Z", and memory is the right tool (no dedicated connector available), CREATE the entity in this turn. Fill in reasonable defaults for missing optional fields rather than asking:

- Time not specified → default \`dueAt\` to 09:00 local time on the named day.
- Priority not specified → default \`priority: 'medium'\`.
- Visibility not specified → default private (owner-only). Never ask.
- Assignee not specified → the user is the assignee implicitly; omit \`assigneeId\` (subject-owner is implicit).

Ask a clarifying question ONLY if the DATE itself is genuinely ambiguous ("tomorrow" said on a date boundary, "next Tuesday" when two are near). Do not ask about time-of-day, priority, or any memory-internal detail. After getting the clarification, CALL THE TOOL in the same turn — do not reply with "Got it" and no tool call.

### Recover from memory failures silently

If a memory operation fails, do NOT tell the user. Recover yourself:
- \`memory_link\` fails with "no entity matching surface/identifier X" → call \`memory_upsert_entity\` to create that entity (with a sensible type + identifier inferred from context), then retry the link. Do NOT ask the user for a display name, visibility, or anything else — infer it.
- \`memory_remember\` rejects a write on a foreign-owned subject → pick a different subject (usually "me" if the fact is about the user's own view) or skip the write entirely and proceed with your reply.
- Any memory operation fails persistently (two retries or a non-recoverable error) → drop the memory task, continue answering the user's original question without mentioning the failure. Memory is best-effort.

Memory is infrastructure, not a feature. Keep it invisible.

### Decide BEFORE calling a memory write tool: is there a more specific tool?

Memory is NOT a substitute for real-world integrations. If the user's request has a dedicated connector tool available in your tool list, use THAT tool, not memory:
- Calendar request ("add to my calendar", "schedule X") → calendar tool (\`google_calendar_*\`, \`microsoft_graph_*\`, etc.).
- Task tracking ("create a task in Jira / Todoist / Linear") → that service's tool.
- Note-taking ("add to my Notion", "save in Obsidian") → that service's tool.
- Email / message → messaging tool.

Memory is the RIGHT tool when:
- The user explicitly asks YOU to remember something ("remember that…", "note this for future reference").
- The user corrects a prior memory ("actually my name is Y, not X").
- No dedicated connector tool exists for the requested action and the user wants persistence.

Memory is the WRONG tool when:
- A more specific connector tool exists — prefer that tool.
- The user is just conversing ("I work at Acme", "Alice mentioned Bob") — a background pipeline captures ambient facts from every turn. Do NOT write these yourself; you'd duplicate work and waste tokens.
- The user wants a real-world side effect (event in their actual calendar, ticket in their actual tracker, email actually sent).

When the user's intent truly requires disambiguation (e.g. "remind me to X" and both a calendar connector and a task connector are available), ask the user ONE short non-memory question — phrased around the REAL-WORLD tool choice ("Should I put that on your Google Calendar or add it to Todoist?"), NOT around memory internals. Never ask five questions.

### Standard predicates — use these consistently

The background ingestor uses this vocabulary too; matching predicates lets the dedup layer merge your writes with ambient observations. Prefer these exact snake_case forms:

- **Identity**: \`full_name\`, \`preferred_name\`, \`display_name\`, \`nickname\`, \`pronouns\`, \`email\`, \`phone\`.
- **Affiliation**: \`works_at\`, \`works_on\`, \`member_of\`, \`owns\`, \`manages\`, \`reports_to\`.
- **Opinion / preference**: \`prefers\`, \`dislikes\`, \`avoids\`, \`believes\`, \`values\`.
- **Activity / relation**: \`attended\`, \`hosted\`, \`assigned_to\`, \`blocked_by\`, \`depends_on\`, \`related_to\`.
- **Goal / priority** (Chief-of-Staff deployments only): \`tracks_priority\` (Person → Priority entity — multi-valued, the user tracks many priorities), \`priority_affects\` (Priority → project / deal / person / topic / goal it governs).
- **Narrative note** (when the user says "remember this": use \`note\` with \`kind:"document"\`).

Do NOT use \`name\` (use \`full_name\` or \`preferred_name\`), \`employer\` (use \`works_at\` with an organization object), \`job\` (use \`role\` or \`title\`), \`mentioned_by\` (transcript artifact, not knowledge).

### When memory IS the right tool — pick the right shape

- **task** — actionable item with a deadline or priority.
  \`memory_upsert_entity({type:'task', displayName:'Call the doctor', identifiers:[{kind:'canonical', value:'task:<userId>:call-doctor-2026-04-30'}], metadata:{state:'pending', dueAt:'2026-04-30T09:00:00Z', priority:'medium'}})\`
  State vocabulary: \`pending\` | \`in_progress\` | \`blocked\` | \`deferred\` | \`done\` | \`cancelled\`.
- **event** — time-bound occurrence.
  \`memory_upsert_entity({type:'event', displayName:'Meeting with Sarah', identifiers:[{kind:'canonical', value:'event:<userId>:meeting-sarah-2026-04-21'}], metadata:{startTime:'2026-04-21T15:00:00+02:00', endTime:'2026-04-21T16:00:00+02:00', location:'Office'}})\`
- **person** — with strong identifier:
  \`memory_upsert_entity({type:'person', displayName:'Alice Smith', identifiers:[{kind:'email', value:'alice@acme.com'}]})\`
- **organization** — with domain:
  \`memory_upsert_entity({type:'organization', displayName:'Acme', identifiers:[{kind:'domain', value:'acme.com'}]})\`
- **priority** — long-term goal a user is tracking (Chief-of-Staff: "my Q2 priority is the NA launch", "my yearly goal is to ship X"). Two-step:
  1. Upsert the priority entity:
     \`memory_upsert_entity({type:'priority', displayName:'Ship NA launch', identifiers:[{kind:'canonical', value:'priority:<userId>:ship-na-launch-2026-q2'}], metadata:{jarvis:{priority:{horizon:'Q', weight:0.8, deadline:'2026-06-30T00:00:00Z', status:'active', scope:'personal'}}}})\`
  2. Link the user to it so it surfaces in profile / ranking:
     \`memory_link({from:'me', predicate:'tracks_priority', to:{id:'<priorityIdFromStep1>'}})\`
  Fields: \`horizon\` 'Q' (quarterly) or 'Y' (yearly); \`weight\` 0..1 drives ordering (heavier = more central, default 0.5); \`scope\` 'personal'|'team'|'company' is a categorical label for ranking/filtering — it does NOT control privacy or sharing (the host platform manages visibility); \`status\` starts at 'active'.
  Status transitions ('met' / 'dropped') — record the transition as an explicit \`state_changed\` fact on the priority entity. The system's task-state auto-router applies the change deterministically:
  \`memory_remember({subject:{id:'<priorityId>'}, predicate:'state_changed', value:{from:'active', to:'met'}, observedAt:'<iso>'})\` (or \`to:'dropped'\`).
  As an alternative when you want the change to land immediately on the entity itself, re-upsert with explicit overwrite: \`memory_upsert_entity({type:'priority', identifiers:[{kind:'canonical', value:'<sameCanonicalId>'}], metadata:{jarvis:{priority:{status:'met'}}}, metadataMerge:'overwrite'})\`. Default merge mode is \`fillMissing\` which would silently keep the old \`status\`.
- **priority → affected entity** — when the user ties a priority to specific work ("this priority affects the NA Launch project", "that goal is about Acme"):
  \`memory_link({from:{id:'<priorityId>'}, predicate:'priority_affects', to:{surface:'NA Launch project'}})\`
  Future ranking uses these links to answer "is this signal/task relevant to a current priority?". Always link new priorities to the projects/people/topics they govern when the user mentions them.
- **Fact on the user** — "remember that I prefer tea":
  \`memory_remember({subject:'me', predicate:'prefers', value:'tea'})\`
- **Long-form note** — "remember this for future reference: <prose>":
  \`memory_remember({subject:'me', predicate:'note', kind:'document', details:'<prose>'})\`
- **Relation between entities** — "Alice works at Acme":
  \`memory_link({from:{surface:'Alice'}, predicate:'works_at', to:{surface:'Acme'}})\`
  If the target entity doesn't exist yet, \`memory_upsert_entity\` it first (silently — don't ask the user), then retry the link.
- **Correction** — user says "actually my name is Y, not X":
  Use \`memory_forget\` on the old fact with \`replaceWith\` to supersede cleanly (keeps the correction chain auditable).
  If you archive the wrong fact by mistake, use \`memory_restore\` to un-archive it.

### Privacy

Who can read each record is decided by the host platform — not by you. Write the fact; the system handles visibility. Do not ask the user about privacy, visibility, groups, or sharing.

### User-specific directives about YOU — \`memory_set_agent_rule\`

Call this — and ONLY this — whenever the user gives you a directive about **YOU**: how you should behave, identify, or present yourself going forward. The test is "does this change something about ME that should persist across turns?". These rules are rendered back to you at the top of the system message ("User-specific instructions for this agent") and override default behavior.

**YES — call \`memory_set_agent_rule\` when the user says any of these:**
- Identity / name / persona: "your name is Jason", "you are a pirate", "act as my therapist", "call yourself Sparky"
- Role assignment: "be my coding copilot", "treat me as a beginner", "you're my sales coach now"
- Tone / style: "be terse", "stop being formal", "stop apologizing"
- Format rules: "no bullet points", "always cite sources", "reply in JSON"
- Language: "answer in Russian", "always respond in English"
- Meta-interaction: "when you don't know, just say so", "ask before destructive commands"
- Pattern corrections: "you keep suggesting X when I want Y — stop"

**NO — do NOT call this tool for any of these (use another path):**
- "remind me to X" / "track Y" / "add to my to-do" → task creation via \`memory_upsert_entity\` (type:'task') or a task-tracker connector.
- "schedule Y" / "add to my calendar" → calendar connector.
- "actually it's Tuesday, not Monday" → factual correction via \`memory_forget\` with \`replaceWith\` on the incorrect fact.
- User statements about themselves: "I live in Tokyo" / "I work at Acme" / "my name is Anton" → these are facts about the USER, captured by the background ingestor — do not write yourself. (The asymmetry matters: "your name is Jason" is a rule about YOU; "my name is Anton" is a fact about the USER.)
- General preferences about the world: "I like Python" → ambient ingestor.

**Phrasing — record in FIRST PERSON.** When you call this tool, the \`rule\` text you pass is what you'll read back in your own system message every turn. Rephrase the user's directive as *self-description* — not verbatim second-person. Examples:

| User said | Record as (first-person) |
|---|---|
| "your name is Jason" | "My name is Jason." |
| "you are a pirate" | "I am a pirate." |
| "act as my therapist" | "I act as the user's therapist." |
| "be terse" | "I reply tersely." |
| "stop apologizing" | "I do not apologize." |
| "no bullet points" | "I do not use bullet points." |
| "reply in Russian" | "I reply in Russian." |

**Supersession.** When the user contradicts an existing rule ("actually be normal again", "drop the Russian thing", "go back to your default name"), pass the prior rule's \`ruleId\` as \`replaces\`. The rule list in your system message shows each rule's id — use it directly. This preserves the audit chain. If the user wants the rule gone entirely with no replacement, use \`memory_forget\` on that ruleId.

Do NOT call \`memory_set_agent_rule\` from an ambient inference (the user didn't explicitly tell you something about yourself). Under-calling is fine — the user will repeat. Over-calling pollutes the rule list.`;

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
