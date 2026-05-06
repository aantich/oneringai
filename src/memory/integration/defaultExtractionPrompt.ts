/**
 * Default prompt template for signal → memory extraction.
 *
 * **Prompt version: 5** — bump this number whenever the prompt surface changes
 * materially so callers pinning snapshots notice.
 *   - v5: restraint posture controls (`EagernessProfile`) — optional
 *         `whyActionable`, optional per-fact `evidenceQuote`, optional
 *         priority/anchor binding, configurable negative-example slot.
 *         Backward-compatible: omit `eagerness` to keep v4 behavior.
 *   - v4: nonce-wrapped `<signal_content_*>` delimiters (prompt-injection defense).
 *   - v3: closed predicate vocabulary warning when a registry is present.
 *   - v2: "## Parsimony" section (zero-fact is valid, expected fact counts, neg/pos example);
 *         metadata-on-mentions for task/event structural fields;
 *         state-change routing guidance (single `state_changed` fact; no separate attrs).
 *
 * The LLM is instructed to return JSON with:
 *   - `mentions`: map of local labels → entity surface forms (+ optional metadata)
 *   - `facts`: triples referencing mention labels (not entity IDs)
 *   - `whyActionable` (optional, required by `requireJustification`): one-sentence
 *     justification — only present when output is non-empty
 *
 * The memory layer's `ExtractionResolver` then translates mention labels into
 * entity IDs (via `upsertEntityBySurface`) and writes the facts. When an
 * extracted fact is `state_changed` on a task subject, routing fires the
 * task state machine automatically.
 *
 * Override via `ExtractionResolverOptions.promptTemplate` for custom behavior
 * (domain-specific predicate vocabularies, extra metadata, etc.).
 */

export const DEFAULT_EXTRACTION_PROMPT_VERSION = 5;

import type { PredicateRegistry } from '../predicates/PredicateRegistry.js';
import type { IEntity, ScopeFields } from '../types.js';
import type { Anchor } from './AnchorRegistry.js';
import type { EagernessProfile } from './EagernessProfile.js';

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

  /**
   * Restraint posture. When present, the prompt renders the corresponding
   * "Restraint" section that turns silence into the easy answer:
   *   - `requireJustification` → adds a top-level `whyActionable` field that
   *     is required *only* when output is non-empty.
   *   - `requireEvidenceQuote` → adds `evidenceQuote` to each fact (soft:
   *     advised; strict: required).
   *   - `requirePriorityBinding` → renders the active anchors and asks for
   *     `servesAnchorId` per task mention.
   *   - `negativeExamplesCount` → controls how many entries from
   *     `negativeExamples` are rendered as "do NOT do this" patterns.
   *
   * Omit `eagerness` to keep the v4 behavior (no Restraint section).
   */
  eagerness?: EagernessProfile;

  /**
   * Active anchors (priorities, OKRs, focus areas) for the user. Surfaced in
   * the prompt only when `eagerness.requirePriorityBinding !== 'off'`. Each
   * anchor's `id` is what the LLM should echo back as `servesAnchorId`.
   */
  anchors?: Anchor[];

  /**
   * Recent dismissals to inject as negative examples. Rendered up to
   * `eagerness.negativeExamplesCount`. Each entry is a short snippet the user
   * already chose to ignore — strong calibration signal.
   */
  negativeExamples?: Array<{ snippet: string; reason?: string }>;

  /**
   * Prior conversation context (e.g. earlier emails in the same thread,
   * earlier turns in a transcript) that has ALREADY been extracted in
   * previous pipeline runs. Rendered as a clearly-labeled "DO NOT extract"
   * background block — the LLM must use it for grounding (resolving "she",
   * binding follow-up commitments to the original task) but MUST NOT emit
   * facts or mentions whose source is exclusively this prior content.
   *
   * Each entry is a short header (e.g. `From Anton at 2026-05-06T08:44Z`)
   * plus the message body, ideally already de-quoted by the host so the
   * same sentence doesn't appear repeatedly across nested replies.
   *
   * Pair with the existing canonical-id rule for tasks: a commitment seen
   * in the delta that was already extracted from a prior message MUST yield
   * the SAME canonical id, so the resolver merges into the existing entity
   * instead of creating a duplicate.
   */
  priorThreadContext?: Array<{ header: string; body: string }>;
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
    eagerness,
    anchors,
    negativeExamples,
    priorThreadContext,
  } = ctx;

  const source = signalSourceDescription ? `Source: ${signalSourceDescription}\n` : '';
  const scopeDescription = describeScope(targetScope ?? {});
  const preResolvedSection = renderPreResolvedBindings(preResolvedBindings);
  const knownSection = renderKnownEntities(knownEntities);
  const restraintSection = renderRestraintSection(eagerness, anchors, negativeExamples);
  const factSchemaSuffix = eagerness ? renderFactSchemaSuffix(eagerness) : '';
  const topLevelJustification = eagerness?.requireJustification
    ? ',\n  "whyActionable": "<one sentence — REQUIRED only when mentions or facts are non-empty>"'
    : '';
  // Nonce-wrapped delimiters prevent signal-body injection. A raw `</signal_content>`
  // inside an attacker-controlled email body would otherwise close the tag and let
  // the rest of the body read as prompt instructions.
  const nonce = makeNonce();
  const openTag = `signal_content_${nonce}`;
  const closeTag = `/signal_content_${nonce}`;
  const priorOpenTag = `prior_thread_context_${nonce}`;
  const priorCloseTag = `/prior_thread_context_${nonce}`;
  const priorThreadSection = renderPriorThreadContext(
    priorThreadContext,
    priorOpenTag,
    priorCloseTag,
  );
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
${priorThreadSection}
<${openTag}>
${signalText}
<${closeTag}>
${preResolvedSection}${knownSection}${restraintSection}

## Output format
Return JSON with the following top-level keys:

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
        // task:  { "state": "proposed", "dueAt": "2026-04-30", "assigneeId": "<label>", "priority": "high", "servesAnchorId": "<anchor_id>" }
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
      "validUntil": "YYYY-MM-DDTHH:MM:SSZ", // ISO-8601; optional${factSchemaSuffix}
    }
  ]${topLevelJustification}
}

## Parsimony (most important)
Output AT MOST ONE fact per distinct piece of knowledge gained. Narrative context goes in \`details\` of that single fact, not into separate facts.

If the signal conveys nothing substantive (pleasantry, acknowledgment, auto-reply, routing banner), output empty arrays. **Zero facts is a valid — often correct — output.**

Expected fact counts by signal type:
- **Trivial** ("thanks!", "got it", calendar auto-reply): **0 facts**
- **Substantive single-topic** (one commitment, one decision, one observation): **1 fact**
- **Multi-topic** (two distinct commitments, a decision + a concern): **2 facts**
- **Long transcript / meeting recap**: **3–6 facts** — the salient decisions and commitments, NOT every sentence

## Tasks: ONE commitment = ONE task (do NOT decompose)
A single commitment, decision, or unblock-request becomes a SINGLE task — even when it spans multiple sub-actions, integrations, or deliverables. The Decision Queue is a tool for the executive: 7 cards for one conversation is rejection territory.

- "Set up Microsoft, Google, Slack, and Zoom integrations on test/staging" → ONE task, not four.
- "Grant Ekaterina access so she can configure the integrations" → ONE task ("Grant Ekaterina access to test/staging"), not three (one per integration + one for access + one for verification).
- "Merge Jovan's PRs and run the EKE demo" → if both fall under the same person/timeline, ONE task ("Prepare EKE demo: merge PRs and run"). Two genuinely independent commitments → two tasks.

The narrative or evidence quote captures the sub-actions inside the task body; the task surface names the decision. Sub-action lists belong in the \`details\` field of the COMMITMENT FACT (e.g. the \`committed_to\` fact pointing at the task), NOT in additional task mentions.

### Negative example — TASK OVER-DECOMPOSITION (frequent failure mode)
Signal (single email): "Ekaterina will set up Microsoft, Google, Slack, and Zoom integrations on test and staging as soon as Vitaly grants her access."

BAD output (5 tasks for one commitment):
- \`task: Set up Microsoft integration on test/staging\`
- \`task: Set up Google integration on test/staging\`
- \`task: Set up Slack integration on test/staging\`
- \`task: Set up Zoom integration on test/staging\`
- \`task: Grant Ekaterina access\`

CORRECT output (one actionable task — the unblock):
- \`task: Grant Ekaterina test/staging access (so she can configure Microsoft/Google/Slack/Zoom integrations)\`

The thing the EXEC can act on is granting access. The integrations are downstream of that and belong in the task narrative, not as separate cards.

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
      "identifiers": [{ "kind": "canonical", "value": "task:meet-sarah-erp-renewal-2026-THU" }],
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
   - **Task**: \`{ type: "task", surface: "Send budget", identifiers: [{ "kind": "canonical", "value": "task:send-budget-2026-04-30" }], metadata: { "state": "proposed", "dueAt": "2026-04-30", "assigneeId": "<label>", "priority": "high" } }\`
   - **Event**: \`{ type: "event", surface: "Q3 Planning", metadata: { "startTime": "2026-05-01T10:00:00Z", "endTime": "...", "location": "...", "attendeeIds": ["<label>"] } }\`
   The commitment itself is still a fact: \`{ subject: "john_label", predicate: "committed_to", object: "task_label" }\`. But "this task is due 2026-04-30" is metadata, not a separate \`has_due_date\` fact.

   **State changes** use a single \`state_changed\` fact — the system routes it through the task-state machine automatically. Emit \`{ subject: "task_label", predicate: "state_changed", value: { "from": "in_progress", "to": "done" } }\` — the task's metadata, history, and completedAt all update as a side effect.

   **REQUIRED canonical identifier on every task mention.** Tasks have no natural strong identifier (unlike a person's email or a domain). Without a canonical id, the same commitment seen across multiple signals (thread replies, transcripts, follow-ups) creates duplicate task entities — a known production bug pattern. So every \`type: "task"\` mention MUST include:

   \`\`\`
   "identifiers": [{ "kind": "canonical", "value": "task:<verb>-<key-noun>-<YYYY-MM-DD>" }]
   \`\`\`

   - \`<verb>\`: short imperative — \`grant\`, \`merge\`, \`send\`, \`review\`, \`schedule\`, \`unblock\`, \`prep\`.
   - \`<key-noun>\`: the most identifying object phrase, lowercased and hyphen-separated, ≤ 4 words. The PERSON, ORG, or ARTIFACT that uniquely identifies the commitment — NOT every detail.
   - \`<YYYY-MM-DD>\`: the task's due date if known; otherwise the date this commitment was first made (typically the signal's reference date).

   Examples:
   - "Grant Ekaterina access to test/staging" (made 2026-05-06) → \`task:grant-ekaterina-access-2026-05-06\`
   - "Send Q3 budget to Sarah by Apr 30" → \`task:send-q3-budget-2026-04-30\`
   - "Merge Jovan's PRs for EKE demo" (made 2026-05-06) → \`task:merge-jovan-prs-2026-05-06\`

   Same commitment surfaced across multiple signals MUST yield the SAME canonical id — that's how the resolver dedupes. If the second signal merely re-references an existing commitment (a thread reply, a meeting follow-up), produce the SAME canonical id you'd produce from the original; the system will merge into the existing task entity.
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

/**
 * Render the prior-thread context block — earlier messages in the same thread
 * whose facts have already been extracted in prior pipeline runs. The LLM
 * must use this as background ONLY (resolving "she", binding follow-ups to
 * already-extracted commitments via canonical id) and MUST NOT extract from
 * it. Wrapped in a nonce-tagged delimiter to defend against the same
 * prompt-injection class as the main signal body.
 */
function renderPriorThreadContext(
  context: Array<{ header: string; body: string }> | undefined,
  openTag: string,
  closeTag: string,
): string {
  if (!context || context.length === 0) return '';
  const blocks = context
    .map((c) => `--- ${c.header} ---\n${c.body.trim()}`)
    .join('\n\n');
  return `\n## Prior thread context (background only — DO NOT extract from this)
The messages below are earlier turns in the SAME conversation. Their facts have ALREADY been extracted in prior pipeline runs. Treat them as background ONLY:

- Use them to resolve pronouns ("she", "the deal", "that PR") in the new message.
- Use them to recognise that a commitment in the new message is a follow-up to an existing task — emit the SAME canonical id you'd produce from the original (per rule 4), so the resolver merges into the existing entity instead of creating a duplicate.
- Do NOT emit facts or task mentions whose source is exclusively this prior content. The signal_content block (further below) is the extraction target. The prior_thread_context block is reference material.

<${openTag}>
${blocks}
<${closeTag}>
`;
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

/** Short random token — makes delimiter tags unguessable so attacker-controlled
 *  signal text cannot close them. Not a security boundary on its own; the
 *  prompt still leans on the model following instructions. */
function makeNonce(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Render the v5 "Restraint" section. Only emits when an `EagernessProfile` is
 * supplied — chatty/no-eagerness callers see the v4 prompt unchanged.
 *
 * The section reframes the LLM's job: silence is the easy answer; output
 * requires explicit justification, evidence, and (when configured) a binding
 * to a stated user priority.
 */
function renderRestraintSection(
  eagerness: EagernessProfile | undefined,
  anchors: Anchor[] | undefined,
  negativeExamples: Array<{ snippet: string; reason?: string }> | undefined,
): string {
  if (!eagerness) return '';

  // Skip the section entirely when no flag is gating anything — otherwise
  // chatty callers that pass `EAGERNESS_PRESETS.chatty` get the preamble
  // for no reason and burn tokens on every call. The "chatty" preset is
  // semantically equivalent to "no eagerness profile".
  const nCount = Math.max(0, Math.min(5, eagerness.negativeExamplesCount | 0));
  const willRenderNegatives =
    nCount > 0 && !!negativeExamples && negativeExamples.length > 0;
  const hasAnyRestraint =
    eagerness.requireJustification ||
    eagerness.requireEvidenceQuote !== 'off' ||
    eagerness.requirePriorityBinding !== 'off' ||
    willRenderNegatives;
  if (!hasAnyRestraint) return '';

  const lines: string[] = [];
  lines.push('');
  lines.push('## Restraint posture');
  lines.push(
    'Silence is the **easy answer**. Output requires evidence and (where configured) a binding to one of the user\'s stated priorities. Acting needs justification; skipping does not. If the signal is thin or noisy, prefer empty arrays.',
  );

  if (eagerness.requireJustification) {
    lines.push('');
    lines.push(
      '- `whyActionable` (top-level): when `mentions` or `facts` is non-empty, write ONE short sentence (≤ 25 words) saying why this is worth the user\'s attention. Omit when both are empty. Padding triggers rejection.',
    );
  }

  if (eagerness.requireEvidenceQuote === 'soft') {
    lines.push(
      '- `evidenceQuote` (per fact, recommended): a verbatim phrase from the signal supporting the fact. Improves auditability; absence is allowed but discouraged.',
    );
  } else if (eagerness.requireEvidenceQuote === 'strict') {
    lines.push(
      '- `evidenceQuote` (per fact, REQUIRED): a verbatim phrase (≤ 200 chars) from the signal that directly supports the fact. Facts without an evidence quote will be DROPPED. Do not paraphrase. Do not synthesize. Quote the source.',
    );
  }

  if (eagerness.requirePriorityBinding !== 'off' && anchors && anchors.length > 0) {
    lines.push('');
    lines.push(
      eagerness.requirePriorityBinding === 'strict'
        ? "### Priority binding (REQUIRED for task mentions)"
        : '### Priority binding (preferred for task mentions)',
    );
    lines.push(
      "The user's currently active priorities. For every `task` mention, include `metadata.servesAnchorId` set to one of these ids:",
    );
    for (const a of anchors) {
      const kind = a.kind ? ` [${sanitizeInlineString(a.kind, 40)}]` : '';
      // Anchor labels often originate from user-editable settings or free
      // text. Sanitize to defang headings/code-fences that could prematurely
      // close the prompt structure or inject pseudo-instructions.
      lines.push(
        `- \`${sanitizeInlineString(a.id, 80)}\`${kind} — ${sanitizeInlineString(a.label, 200)}`,
      );
    }
    if (eagerness.requirePriorityBinding === 'strict') {
      lines.push(
        "If a candidate task does NOT serve any of these priorities, OMIT it. The Decision Queue is for priority-aligned work only — context-only items belong in facts (with `kind: \"document\"`) or are dropped.",
      );
    } else {
      lines.push(
        'When a task plausibly serves a priority, set `servesAnchorId`. When it does not, omit the field — do not invent a binding.',
      );
    }
  } else if (eagerness.requirePriorityBinding === 'strict') {
    // Strict binding requested but no anchors available — instruct LLM to emit nothing taskish.
    lines.push('');
    lines.push('### No active priorities');
    lines.push(
      "The user has no active priorities right now. Under strict priority binding, do NOT emit any `task` mentions. Facts about people/orgs/events are still useful as context.",
    );
  }

  if (willRenderNegatives && negativeExamples) {
    lines.push('');
    lines.push('### Calibration — items the user has DISMISSED before');
    lines.push(
      'Patterns matching these recent dismissals are LOW value for this user. If a candidate task closely resembles them, drop it.',
    );
    // Negative examples come from prior LLM-extracted dismissals, which can
    // ultimately trace back to attacker-controlled signal bodies (emails,
    // scraped pages). Sanitize before splicing into the system prompt so a
    // crafted snippet can't open a fake instruction block.
    for (const ex of negativeExamples.slice(0, nCount)) {
      const reasonStr = ex.reason
        ? `  (reason: ${sanitizeInlineString(ex.reason, 200)})`
        : '';
      lines.push(`- "${sanitizeInlineString(ex.snippet, 200)}"${reasonStr}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Schema-suffix appended inside each fact object. Adds an `evidenceQuote`
 * field comment when the profile asks for it. Empty string under chatty mode.
 */
function renderFactSchemaSuffix(eagerness: EagernessProfile): string {
  if (eagerness.requireEvidenceQuote === 'off') return '';
  const requirement =
    eagerness.requireEvidenceQuote === 'strict'
      ? '<verbatim phrase from the signal — REQUIRED, ≤200 chars>'
      : '<verbatim phrase from the signal — recommended>';
  return `\n      "evidenceQuote": "${requirement}"`;
}

/**
 * Defang a single-line string before splicing into the prompt. Caps length,
 * collapses newlines (so a crafted multi-line snippet can't open a fake
 * heading or code fence on a fresh line), strips backticks (which would
 * close our inline `code` spans), and removes the markdown heading prefix
 * `#` at line start. Not a security boundary — the LLM still has to follow
 * instructions — but raises the bar for prompt-injection via
 * attacker-derived strings (anchor labels, negative-example snippets).
 */
function sanitizeInlineString(s: string, maxLen: number): string {
  const noBreaks = s.replace(/[\r\n]+/g, ' ');
  const noFences = noBreaks.replace(/`/g, "'");
  const noHeading = noFences.replace(/^[\s>#]+/, '').trimStart();
  const trimmed = noHeading.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen) + '…';
}
