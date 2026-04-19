/**
 * Default prompt template for signal → memory extraction.
 *
 * **Prompt version: 2** — bump this number whenever the prompt surface changes
 * materially so callers pinning snapshots notice. v2 added:
 *   - "## Parsimony" section (zero-fact is valid, expected fact counts, neg/pos example)
 *   - Metadata-on-mentions for task/event structural fields
 *   - State-change routing guidance (single `state_changed` fact; no separate attrs)
 *
 * The LLM is instructed to return JSON with:
 *   - `mentions`: map of local labels → entity surface forms (+ optional metadata)
 *   - `facts`: triples referencing mention labels (not entity IDs)
 *
 * The memory layer's `ExtractionResolver` then translates mention labels into
 * entity IDs (via `upsertEntityBySurface`) and writes the facts. When an
 * extracted fact is `state_changed` on a task subject, routing fires the
 * task state machine automatically.
 *
 * Override via `ExtractionResolverOptions.promptTemplate` for custom behavior
 * (domain-specific predicate vocabularies, extra metadata, etc.).
 */

export const DEFAULT_EXTRACTION_PROMPT_VERSION = 3;

import type { PredicateRegistry } from '../predicates/PredicateRegistry.js';
import type { IEntity, ScopeFields } from '../types.js';

/**
 * A label already bound to an entity before the LLM runs. Typically produced
 * from signal metadata (email headers, calendar attendees, Slack user list) —
 * strong identifiers let us resolve deterministically and hand the LLM a
 * pre-bound vocabulary so it can reference `m1`, `m2` directly in its output
 * without re-declaring them as mentions.
 */
export interface PreResolvedBinding {
  /** Stable local label (e.g. `m1`). The LLM must use this verbatim in facts. */
  label: string;
  /** Resolved entity — surfaced in the prompt as a human-readable hint. */
  entity: IEntity;
  /** Source role (e.g. `from`, `to`, `cc`, `author`, `attendee`). Free-form. */
  role?: string;
}

export interface ExtractionPromptContext {
  /** Raw text of the signal (email body, transcript, doc content, …). */
  signalText: string;
  /** Optional hint describing where this came from, e.g. "email from john@acme.com". */
  signalSourceDescription?: string;
  /** Scope the extractor should treat as target — guides the LLM's privacy judgment. */
  targetScope?: ScopeFields;
  /** Optional pre-loaded entity candidates the extractor can reference by name. */
  knownEntities?: IEntity[];
  /** Reference date for interpreting relative dates ("next Friday"). Defaults to today. */
  referenceDate?: Date;
  /**
   * When present, the registry's vocabulary is rendered into the prompt so the
   * LLM learns the canonical predicate names + aliases + examples. The LLM may
   * still invent new predicates; unknowns canonicalize at write time and land
   * in `IngestionResult.newPredicates` for review.
   */
  predicateRegistry?: PredicateRegistry;
  /** Cap on predicates shown per category (keeps prompt token budget bounded). Default 5. */
  maxPredicatesPerCategory?: number;
  /**
   * Labels already bound to entities upstream (typically by signal metadata
   * extraction). The prompt renders them as a locked vocabulary and instructs
   * the LLM to reference them directly in facts without redeclaring them.
   */
  preResolvedBindings?: PreResolvedBinding[];
}

export function defaultExtractionPrompt(ctx: ExtractionPromptContext): string {
  const {
    signalText,
    signalSourceDescription,
    targetScope,
    knownEntities,
    referenceDate = new Date(),
    predicateRegistry,
    maxPredicatesPerCategory = 5,
    preResolvedBindings,
  } = ctx;

  const source = signalSourceDescription ? `Source: ${signalSourceDescription}\n` : '';
  const scopeDescription = describeScope(targetScope ?? {});
  const preResolvedSection = renderPreResolvedBindings(preResolvedBindings);
  const knownSection = renderKnownEntities(knownEntities);
  // v3 (H5): when a registry is present, explicitly tell the LLM the
  // vocabulary is closed. The server still applies a fuzzy-mapping fallback
  // for near-misses, but the instruction here prevents most drift from ever
  // reaching the resolver.
  const predicateSection = predicateRegistry
    ? '\n\n' +
      predicateRegistry.renderForPrompt({ maxPerCategory: maxPredicatesPerCategory }) +
      '\n\n**Use ONLY the predicates listed above. Do NOT invent new ones.** ' +
      'If no listed predicate is a perfect fit, pick the closest match and put ' +
      'the nuance in `details`. Unknown predicates are either auto-mapped to the ' +
      'nearest known name (possibly incorrectly) or dropped.'
    : '';

  return `You are extracting structured memory from a signal (email, message, document excerpt, etc.).
Your output populates a knowledge graph of entities (people, organizations, tasks, events, projects, topics) and facts (triples) about them.

## Signal
${source}Reference date: ${referenceDate.toISOString().slice(0, 10)}
Target scope: ${scopeDescription}

<signal_content>
${signalText}
</signal_content>
${preResolvedSection}${knownSection}

## Output format
Return JSON with exactly two top-level keys:

{
  "mentions": {
    "<local_label>": {
      "surface": "<verbatim text as it appeared>",
      "type": "<person | organization | project | task | event | topic | cluster>",
      "identifiers": [{ "kind": "<email|domain|slack_id|phone|github|canonical|...>", "value": "..." }],
      "aliases": ["<alternate form nearby in text>"],
      "metadata": {
        // Optional type-specific fields. ONLY set on first observation; the
        // resolver will NOT overwrite existing values on re-extraction.
        // task:  { "state": "proposed", "dueAt": "2026-04-30", "assigneeId": "<label>", "priority": "high" }
        // event: { "startTime": "2026-05-01T10:00:00Z", "endTime": "...", "location": "...", "attendeeIds": ["<label>"] }
      }
    }
  },
  "facts": [
    {
      "subject": "<local_label>",
      "predicate": "<snake_case_relation>",
      "object": "<local_label>",          // for relational facts; set EITHER object OR value, never both
      "value": "<any JSON>",                // for attribute facts
      "details": "<optional free-text narrative>",
      "confidence": 0.0-1.0,
      "importance": 0.0-1.0,                // how much this matters long-term (0.5 default)
      "contextIds": ["<local_label>"],      // other entities this fact is "about"
      "kind": "atomic",                     // MUST be exactly "atomic" OR "document" — see Fact kinds below
      "validFrom": "YYYY-MM-DDTHH:MM:SSZ",  // ISO-8601; optional — see Validity period below
      "validUntil": "YYYY-MM-DDTHH:MM:SSZ"  // ISO-8601; optional
    }
  ]
}

## Parsimony (most important)
Output AT MOST ONE fact per distinct piece of knowledge gained. Narrative context goes in \`details\` of that single fact, not into separate facts.

If the signal conveys nothing substantive (pleasantry, acknowledgment, auto-reply, routing banner), output empty arrays. **Zero facts is a valid — often correct — output.**

Expected fact counts by signal type:
- **Trivial** ("thanks!", "got it", calendar auto-reply): **0 facts**
- **Substantive single-topic** (one commitment, one decision, one observation): **1 fact**
- **Multi-topic** (two distinct commitments, a decision + a concern): **2 facts**
- **Long transcript / meeting recap**: **3–6 facts** — the salient decisions and commitments, NOT every sentence

### Negative example — DO NOT DO THIS
Signal: "Hi Sarah, we need to discuss ERP renewal. Worried Oracle's pricing won't work. Can we meet Thursday? – John"

BAD output (5 facts for a single-topic email):
- \`(john, discussed_topic, erp_renewal)\`
- \`(john, proposed_meeting_with, sarah)\`
- \`(john, committed_to, task:meet_sarah)\`
- \`(john, expressed_concern, "Oracle pricing")\`
- \`(topic:erp_renewal, discussed_in, signal:X)\`

### Positive example
Same signal. CORRECT output:
\`\`\`json
{
  "mentions": {
    "t1": {
      "surface": "Meet Sarah about ERP renewal",
      "type": "task",
      "metadata": { "state": "proposed", "assigneeId": "m_john", "dueAt": "2026-THU" }
    }
  },
  "facts": [
    {
      "subject": "m_john",
      "predicate": "discussed_topic",
      "object": "topic_erp_renewal_label",
      "contextIds": ["m_sarah", "t1"],
      "details": "Worried that Oracle's pricing for ERP renewal won't work; proposed meeting Sarah Thursday to discuss.",
      "importance": 0.7,
      "confidence": 0.85,
      "kind": "atomic"
    }
  ]
}
\`\`\`

One fact. The narrative (concern + proposal + scheduling) lives in \`details\`. The task is an entity with metadata carrying its state + due date. The proposed meeting with Sarah surfaces on queries about the deal via \`contextIds\`.

## Fact kinds
Every fact must set \`kind\` to **exactly one** of these two values — no others are accepted by the storage layer:

- **"atomic"** — a single triple (subject, predicate, value | object). Short, structured, scalar. DEFAULT choice.
  - attributes: \`{predicate: "employee_count", value: 500}\`
  - relations: \`{predicate: "attended", object: "m3"}\`
  - short observations: \`{predicate: "raised_concern", details: "timeline risk"}\`

- **"document"** — long-form narrative about the subject (multi-sentence prose: a procedure, rationale, learned pattern, meeting recap). Use when the content is a coherent piece of text rather than a discrete datum.
  - \`{predicate: "learned_pattern", details: "When users ask for tax calculations, always clarify the jurisdiction before quoting rates because …", kind: "document"}\`
  - \`{predicate: "meeting_recap", details: "Attendees agreed on Q3 launch date; Alice owns …", kind: "document"}\`

Do **NOT** invent other values (e.g. "note", "observation", "insight"). Unknown kinds are rejected or silently coerced to "atomic" downstream — you lose control either way.

## Validity period
Facts carry time-boxed relevance. Set \`validUntil\` when the fact stops being true; leave it undefined for timeless facts. \`validFrom\` defaults to the fact's observation time — only set it explicitly when the fact becomes true in the FUTURE or had a start date in the past distinct from observation.

Calibration:
- **Ephemeral** (today-only, session-bounded): \`validUntil\` = end of today. Examples: "working from home today", "out of office until 5pm".
- **Task-bounded**: \`validUntil\` = expected completion / due date. Examples: "assigned_task", "owns" (for a time-boxed project role).
- **Project/quarter-bounded**: \`validUntil\` = project or quarter end. Examples: "rotating_oncall", "Q3 priority".
- **Identity / employment / long-lived**: leave \`validUntil\` undefined. Examples: "works_at", "employee_count", "prefers" (unless the user qualified it).
- **Superseded by a later fact** (role change, preference change): leave \`validUntil\` undefined here — use \`supersedes\` in the new fact.

When unsure, PREFER leaving \`validUntil\` undefined over guessing — a too-early expiry silently hides the fact from queries. Queries that filter by \`asOf\` treat "no validUntil" as "valid forever".

## Guidelines
1. **Mentions, not IDs.** The LLM never sees entity IDs. Use local labels like "m1", "m2" to reference entities within this extraction. The system will resolve labels to existing entities or create new ones. If the prompt contains a "Pre-resolved labels" block, those labels are already bound — reference them directly in \`facts\` and DO NOT redeclare them in \`mentions\`.
2. **Strong identifiers.** Extract every strong identifier you can (email, domain, slack_id, github). These are the best signal for deduplication.
3. **Capture surface variants.** If the text uses "Microsoft" and "MSFT" for the same org, include both under the mention's \`aliases\`.
4. **Tasks and events are entities with metadata — NOT a pile of facts.**
   Mention-level \`metadata\` carries the structural fields. Do NOT restate them as separate facts.
   - **Task**: \`{ type: "task", surface: "Send budget", metadata: { "state": "proposed", "dueAt": "2026-04-30", "assigneeId": "<label>", "priority": "high" } }\`
   - **Event**: \`{ type: "event", surface: "Q3 Planning", metadata: { "startTime": "2026-05-01T10:00:00Z", "endTime": "...", "location": "...", "attendeeIds": ["<label>"] } }\`
   The commitment itself is still a fact: \`{ subject: "john_label", predicate: "committed_to", object: "task_label" }\`. But "this task is due 2026-04-30" is metadata, not a separate \`has_due_date\` fact.

   **State changes** use a single \`state_changed\` fact — the system routes it through the task-state machine automatically. Emit \`{ subject: "task_label", predicate: "state_changed", value: { "from": "in_progress", "to": "done" } }\` — the task's metadata, history, and completedAt all update as a side effect.
5. **Use contextIds for deal/project/meeting binding.** If John's commitment happens in the context of an Acme deal, add the deal's label to the fact's \`contextIds\`. The deal is not subject or object but the activity should be surfaced when querying the deal.
6. **Importance calibration.**
   - 1.0: identity-level facts ("X is CEO", "X works at Y")
   - 0.7: significant decisions, commitments, state changes
   - 0.5: default / observed topics
   - 0.2: trivial / ephemeral observations
7. **Confidence** reflects how sure you are the fact is TRUE, not how important it is.
8. **One observation = one fact.** If the same fact is stated multiple times, emit it once.
9. **Skip pleasantries, greetings, boilerplate.** Extract only what carries knowledge.
10. **Output ONLY the JSON.** No surrounding prose, no code fences.${predicateSection}`;
}

// -------------------------------------------------------------------------

function describeScope(scope: ScopeFields): string {
  if (!scope.groupId && !scope.ownerId) return 'global (visible to all)';
  if (scope.ownerId && !scope.groupId) return `user-private (owner=${scope.ownerId})`;
  if (scope.groupId && !scope.ownerId) return `group-wide (group=${scope.groupId})`;
  return `user-private within group (group=${scope.groupId}, owner=${scope.ownerId})`;
}

function renderPreResolvedBindings(bindings?: PreResolvedBinding[]): string {
  if (!bindings || bindings.length === 0) return '';
  const lines = bindings.map((b) => {
    const idStr = b.entity.identifiers
      .slice(0, 2)
      .map((i) => `${i.kind}=${i.value}`)
      .join(', ');
    const role = b.role ? `${b.role}: ` : '';
    const identity = idStr ? ` (${idStr})` : '';
    return `- \`${b.label}\` — ${role}${b.entity.type} "${b.entity.displayName}"${identity}`;
  });
  const maxIndex = bindings
    .map((b) => {
      const m = /^m(\d+)$/.exec(b.label);
      return m ? Number(m[1]) : 0;
    })
    .reduce((a, b) => (b > a ? b : a), 0);
  const nextHint =
    maxIndex > 0
      ? `When introducing NEW entities from the signal body, start labels at \`m${maxIndex + 1}\`.`
      : 'When introducing NEW entities from the signal body, choose labels that do not collide with the ones above.';
  return `\n## Pre-resolved labels
The following local labels are ALREADY bound to entities in the knowledge graph. Reference them directly in \`facts\`. DO NOT redeclare them in \`mentions\`.

${lines.join('\n')}

${nextHint}\n`;
}

/**
 * Render the "Known entities" block with type-aware details. Tasks surface
 * `state` + `dueAt`; events surface `startTime` + `endTime`; other types get
 * the generic type + identifier rendering.
 *
 * The rendered block instructs the LLM to reuse these entities' surface forms
 * so the resolver converges on existing rows rather than creating duplicates.
 */
function renderKnownEntities(entities?: IEntity[]): string {
  if (!entities || entities.length === 0) return '';
  const lines = entities.slice(0, 40).map(formatKnownEntity).join('\n');
  return `\n## Known entities (reuse their surface forms when referring to them — the resolver will converge on the existing row)\n${lines}\n`;
}

function formatKnownEntity(e: IEntity): string {
  const idStr = e.identifiers
    .slice(0, 2)
    .map((i) => `${i.kind}=${i.value}`)
    .join(', ');
  const md = (e.metadata ?? {}) as Record<string, unknown>;
  const detail = typeSpecificDetail(e.type, md);
  const parts: string[] = [];
  if (detail) parts.push(detail);
  if (idStr) parts.push(idStr);
  const suffix = parts.length > 0 ? ` (${parts.join(' | ')})` : '';
  return `- ${e.type}: "${e.displayName}"${suffix}`;
}

function typeSpecificDetail(type: string, md: Record<string, unknown>): string | null {
  if (type === 'task') {
    const bits: string[] = [];
    if (typeof md.state === 'string') bits.push(`state: ${md.state}`);
    const due = md.dueAt;
    if (due) bits.push(`due: ${formatDateMaybe(due)}`);
    return bits.join(', ') || null;
  }
  if (type === 'event') {
    const bits: string[] = [];
    const start = md.startTime;
    if (start) bits.push(`start: ${formatDateMaybe(start)}`);
    const end = md.endTime;
    if (end) bits.push(`end: ${formatDateMaybe(end)}`);
    return bits.join(', ') || null;
  }
  return null;
}

function formatDateMaybe(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 16) + 'Z';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return new Date(v).toISOString().slice(0, 16) + 'Z';
  return String(v);
}
