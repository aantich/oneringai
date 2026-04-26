/**
 * Standard predicate library — 54 predicates across 9 categories.
 *
 * Shipped with the memory layer; opt-in via `PredicateRegistry.standard()`.
 * Users can extend (`.register(...)`), override, or replace entirely with
 * `PredicateRegistry.empty().registerAll(...)`.
 *
 * Weights and defaultImportance values are seed values — tune via RankingConfig
 * or by overriding specific predicates.
 *
 * Note: `profile` is consumed by MemorySystem.getContext (document fact with
 * predicate='profile' is the canonical per-entity profile). Renaming it would
 * break retrieval.
 */

import type { PredicateDefinition } from './types.js';

export const STANDARD_PREDICATES: PredicateDefinition[] = [
  // ---------------------------------------------------------------------------
  // identity
  // ---------------------------------------------------------------------------
  {
    name: 'works_at',
    description: 'Person-to-organization employment relationship.',
    category: 'identity',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    objectTypes: ['organization'],
    inverse: 'employs',
    aliases: ['worksAt', 'employed_by', 'employee_of'],
    defaultImportance: 1.0,
    rankingWeight: 1.5,
    examples: ['(John, works_at, Acme)'],
  },
  {
    name: 'reports_to',
    description: 'Management chain — subject reports to object.',
    category: 'identity',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    objectTypes: ['person'],
    inverse: 'manages',
    defaultImportance: 0.9,
    rankingWeight: 1.4,
    examples: ['(John, reports_to, Jane)'],
  },
  {
    name: 'current_title',
    description: 'Current job title held by the person.',
    category: 'identity',
    payloadKind: 'attribute',
    subjectTypes: ['person'],
    defaultImportance: 1.0,
    rankingWeight: 1.5,
    singleValued: true,
    examples: ['(John, current_title, "VP of Engineering")'],
  },
  {
    name: 'current_role',
    description: 'Current functional role within an organization or project.',
    category: 'identity',
    payloadKind: 'attribute',
    subjectTypes: ['person'],
    aliases: ['current_position'],
    defaultImportance: 1.0,
    rankingWeight: 1.5,
    singleValued: true,
  },
  {
    name: 'located_in',
    description: 'Geographic or logical location of the subject.',
    category: 'identity',
    payloadKind: 'relational',
    inverse: 'location_of',
    defaultImportance: 0.6,
    rankingWeight: 1.0,
  },
  {
    name: 'is_member_of',
    description: 'Person belongs to an organization, team, or group.',
    category: 'identity',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    objectTypes: ['organization'],
    inverse: 'has_member',
    defaultImportance: 0.8,
    rankingWeight: 1.2,
  },
  {
    name: 'founded',
    description: 'Person founded an organization.',
    category: 'identity',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    objectTypes: ['organization'],
    inverse: 'founded_by',
    defaultImportance: 1.0,
    rankingWeight: 1.3,
  },

  // ---------------------------------------------------------------------------
  // organizational
  // ---------------------------------------------------------------------------
  {
    name: 'part_of',
    description: 'Organizational containment — subject is a division/unit of object.',
    category: 'organizational',
    payloadKind: 'relational',
    inverse: 'has_part',
    defaultImportance: 0.7,
    rankingWeight: 1.1,
  },
  {
    name: 'subsidiary_of',
    description: 'Corporate ownership — subject is a subsidiary of object.',
    category: 'organizational',
    payloadKind: 'relational',
    subjectTypes: ['organization'],
    objectTypes: ['organization'],
    inverse: 'parent_of',
    defaultImportance: 0.9,
    rankingWeight: 1.2,
  },
  {
    name: 'manages',
    description: 'Subject manages object (direct reporting line, inverse of reports_to).',
    category: 'organizational',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    objectTypes: ['person'],
    inverse: 'reports_to',
    defaultImportance: 0.9,
    rankingWeight: 1.4,
  },
  {
    name: 'owns',
    description: 'Subject owns object (asset, company, property).',
    category: 'organizational',
    payloadKind: 'relational',
    inverse: 'owned_by',
    defaultImportance: 0.8,
    rankingWeight: 1.1,
  },
  {
    name: 'acquired',
    description: 'Subject acquired object (M&A event).',
    category: 'organizational',
    payloadKind: 'relational',
    subjectTypes: ['organization'],
    objectTypes: ['organization'],
    inverse: 'acquired_by',
    defaultImportance: 0.9,
    rankingWeight: 1.2,
  },
  {
    name: 'merged_with',
    description: 'Subject merged with object to form a combined entity.',
    category: 'organizational',
    payloadKind: 'relational',
    subjectTypes: ['organization'],
    objectTypes: ['organization'],
    inverse: 'merged_with',
    defaultImportance: 0.9,
    rankingWeight: 1.1,
  },

  // ---------------------------------------------------------------------------
  // task
  // ---------------------------------------------------------------------------
  {
    name: 'assigned_task',
    description: 'Person is assigned to a task.',
    category: 'task',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    objectTypes: ['task'],
    inverse: 'assignee_of',
    defaultImportance: 0.8,
    rankingWeight: 1.3,
  },
  {
    name: 'committed_to',
    description: 'Person made an explicit commitment to complete a task.',
    category: 'task',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    objectTypes: ['task'],
    inverse: 'committer_of',
    aliases: ['committed', 'promised'],
    defaultImportance: 0.9,
    rankingWeight: 1.3,
    examples: ['(John, committed_to, "Send budget by Friday")'],
  },
  {
    name: 'completed',
    description: 'Person completed a task.',
    category: 'task',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    objectTypes: ['task'],
    inverse: 'completed_by',
    defaultImportance: 0.7,
    rankingWeight: 1.2,
  },
  {
    name: 'created',
    description: 'Person created an artifact, task, or document.',
    category: 'task',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    inverse: 'created_by',
    defaultImportance: 0.6,
    rankingWeight: 0.9,
  },
  {
    name: 'reviewed',
    description: 'Person reviewed an artifact.',
    category: 'task',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    inverse: 'reviewed_by',
    defaultImportance: 0.6,
    rankingWeight: 0.9,
  },
  {
    name: 'approved',
    description: 'Person approved a decision, document, or task.',
    category: 'task',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    inverse: 'approved_by',
    defaultImportance: 0.7,
    rankingWeight: 1.0,
  },
  {
    name: 'blocked_by',
    description: 'Task or item is blocked by another task or condition.',
    category: 'task',
    payloadKind: 'relational',
    subjectTypes: ['task'],
    inverse: 'blocks',
    defaultImportance: 0.9,
    rankingWeight: 1.3,
  },
  {
    name: 'depends_on',
    description: 'Task or item depends on another.',
    category: 'task',
    payloadKind: 'relational',
    inverse: 'dependency_of',
    defaultImportance: 0.8,
    rankingWeight: 1.2,
  },
  {
    name: 'has_due_date',
    description: 'Task has a scheduled due date.',
    category: 'task',
    payloadKind: 'attribute',
    subjectTypes: ['task'],
    defaultImportance: 0.9,
    rankingWeight: 1.4,
    singleValued: true,
    examples: ['(task_123, has_due_date, "2026-04-30")'],
  },
  {
    name: 'has_priority',
    description: 'Task priority.',
    category: 'task',
    payloadKind: 'attribute',
    subjectTypes: ['task'],
    defaultImportance: 0.8,
    rankingWeight: 1.2,
    singleValued: true,
  },
  {
    name: 'prepares_for',
    description:
      'Task is prep for an event — completing the task readies the user for the event. ' +
      'Used to propagate event cancellation/reschedule onto bound prep tasks.',
    category: 'task',
    payloadKind: 'relational',
    subjectTypes: ['task'],
    objectTypes: ['event'],
    inverse: 'prepared_by',
    aliases: ['prep_for', 'preparation_for'],
    defaultImportance: 0.8,
    rankingWeight: 1.3,
    examples: ['(task_456, prepares_for, event_789) — "Prepare slides for JP Morgan meeting"'],
  },
  {
    name: 'delegated_to',
    description:
      'Task was handed off to a person to execute. Distinct from `assigned_task` (which records ' +
      'the resulting assignment as person→task): delegation captures the act, the delegator, and ' +
      'the source signal that effected it.',
    category: 'task',
    payloadKind: 'relational',
    subjectTypes: ['task'],
    objectTypes: ['person'],
    inverse: 'delegate_of',
    aliases: ['handed_off_to'],
    defaultImportance: 0.9,
    rankingWeight: 1.3,
    examples: ['(task_123, delegated_to, person_alice) — "do this by Friday"'],
  },
  {
    name: 'cancelled_due_to',
    description:
      'Task or event was cancelled because of another item — typically the cancellation of an ' +
      'underlying event (meeting cancelled → prep task cancelled) or supersession by a newer signal.',
    category: 'task',
    payloadKind: 'relational',
    subjectTypes: ['task', 'event'],
    inverse: 'cancellation_cause_for',
    aliases: ['cancelled_because_of'],
    defaultImportance: 0.9,
    rankingWeight: 1.3,
    examples: ['(task_456, cancelled_due_to, event_789) — meeting was cancelled'],
  },

  // ---------------------------------------------------------------------------
  // state
  // ---------------------------------------------------------------------------
  {
    name: 'state_changed',
    description: 'State transition event — value is { from, to }.',
    category: 'state',
    payloadKind: 'attribute',
    defaultImportance: 0.7,
    rankingWeight: 1.0,
    examples: ['(task_123, state_changed, { from: "open", to: "in_progress" })'],
  },
  {
    name: 'has_status',
    description: 'Current status snapshot.',
    category: 'state',
    payloadKind: 'attribute',
    defaultImportance: 0.8,
    rankingWeight: 1.1,
    singleValued: true,
  },
  {
    name: 'current_status',
    description: 'Most recent status (supersedes prior on write).',
    category: 'state',
    payloadKind: 'attribute',
    defaultImportance: 0.9,
    rankingWeight: 1.3,
    singleValued: true,
  },

  // ---------------------------------------------------------------------------
  // communication
  // ---------------------------------------------------------------------------
  {
    name: 'emailed',
    description: 'Subject sent an email to object.',
    category: 'communication',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    objectTypes: ['person'],
    defaultImportance: 0.4,
    rankingWeight: 0.8,
  },
  {
    name: 'called',
    description: 'Subject called object (phone, video).',
    category: 'communication',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    objectTypes: ['person'],
    defaultImportance: 0.4,
    rankingWeight: 0.8,
  },
  {
    name: 'messaged',
    description: 'Subject messaged object (chat, DM).',
    category: 'communication',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    objectTypes: ['person'],
    defaultImportance: 0.4,
    rankingWeight: 0.8,
  },
  {
    name: 'met_with',
    description: 'Subject met with object (in-person or virtual meeting).',
    category: 'communication',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    objectTypes: ['person'],
    defaultImportance: 0.6,
    rankingWeight: 1.0,
  },
  {
    name: 'mentioned',
    description: 'Subject referenced object in a communication or document.',
    category: 'communication',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    defaultImportance: 0.3,
    rankingWeight: 0.6,
  },
  {
    name: 'cc_ed',
    description: 'Subject CC-ed object on a communication.',
    category: 'communication',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    objectTypes: ['person'],
    defaultImportance: 0.2,
    rankingWeight: 0.5,
  },
  {
    name: 'responded_to',
    description: 'Subject responded to a prior communication.',
    category: 'communication',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    defaultImportance: 0.4,
    rankingWeight: 0.7,
  },
  {
    name: 'interaction_count',
    description: 'Aggregate interaction counter for an entity pair. Value is a number.',
    category: 'communication',
    payloadKind: 'attribute',
    defaultImportance: 0.5,
    rankingWeight: 1.0,
    isAggregate: true,
  },

  // ---------------------------------------------------------------------------
  // observation
  // ---------------------------------------------------------------------------
  {
    name: 'observed_topic',
    description: 'Person was observed discussing a topic.',
    category: 'observation',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    objectTypes: ['topic'],
    defaultImportance: 0.5,
    rankingWeight: 0.8,
  },
  {
    name: 'expressed_concern',
    description: 'Person expressed concern about an entity, topic, or situation.',
    category: 'observation',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    defaultImportance: 0.8,
    rankingWeight: 1.1,
  },
  {
    name: 'expressed_interest',
    description: 'Person expressed interest in an entity, topic, or situation.',
    category: 'observation',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    defaultImportance: 0.7,
    rankingWeight: 1.0,
  },
  {
    name: 'acknowledged',
    description: 'Person acknowledged a fact, statement, or situation.',
    category: 'observation',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    defaultImportance: 0.4,
    rankingWeight: 0.7,
  },
  {
    name: 'noted',
    description: 'Person made a passing observation.',
    category: 'observation',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    defaultImportance: 0.3,
    rankingWeight: 0.6,
  },

  // ---------------------------------------------------------------------------
  // temporal
  // ---------------------------------------------------------------------------
  {
    name: 'occurred_on',
    description: 'Event occurred on a specific date/time. Value is a Date.',
    category: 'temporal',
    payloadKind: 'attribute',
    subjectTypes: ['event'],
    defaultImportance: 0.7,
    rankingWeight: 1.0,
  },
  {
    name: 'scheduled_for',
    description: 'Entity is scheduled for a future date/time. Value is a Date.',
    category: 'temporal',
    payloadKind: 'attribute',
    defaultImportance: 0.8,
    rankingWeight: 1.1,
  },
  {
    name: 'started_on',
    description: 'Subject started on a date. Value is a Date.',
    category: 'temporal',
    payloadKind: 'attribute',
    defaultImportance: 0.7,
    rankingWeight: 0.9,
    singleValued: true,
  },
  {
    name: 'ended_on',
    description: 'Subject ended on a date. Value is a Date.',
    category: 'temporal',
    payloadKind: 'attribute',
    defaultImportance: 0.7,
    rankingWeight: 0.9,
    singleValued: true,
  },

  // ---------------------------------------------------------------------------
  // event  (attendance relationships — seeded by CalendarSignalAdapter)
  // ---------------------------------------------------------------------------
  {
    name: 'attended',
    description: 'Person attended an event (meeting, call, conference).',
    category: 'event',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    objectTypes: ['event'],
    inverse: 'attended_by',
    defaultImportance: 0.5,
    rankingWeight: 0.9,
    examples: ['(Alice, attended, Q3-planning-review)'],
  },
  {
    name: 'hosted',
    description: 'Person hosted or organized an event.',
    category: 'event',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    objectTypes: ['event'],
    inverse: 'hosted_by',
    defaultImportance: 0.7,
    rankingWeight: 1.0,
    examples: ['(Alice, hosted, Q3-planning-review)'],
  },

  // ---------------------------------------------------------------------------
  // priority  (Chief-of-Staff goal tracking; surfaces "what is this user
  // working toward?" via memory_graph walks)
  // ---------------------------------------------------------------------------
  {
    name: 'tracks_priority',
    description:
      'Person tracks a long-term priority (quarterly/yearly goal). Multi-valued — a user typically tracks several priorities.',
    category: 'priority',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    objectTypes: ['priority'],
    inverse: 'tracked_by',
    defaultImportance: 0.9,
    rankingWeight: 1.4,
    examples: ['(me, tracks_priority, "Ship NA launch Q2 2026")'],
  },
  {
    name: 'priority_affects',
    description:
      'Priority bears on / governs another entity (project, deal, person, topic). Used to answer "is X relevant to a current priority?".',
    category: 'priority',
    payloadKind: 'relational',
    subjectTypes: ['priority'],
    inverse: 'affected_by_priority',
    defaultImportance: 0.8,
    rankingWeight: 1.2,
    examples: ['("Ship NA launch", priority_affects, "NA Launch project")'],
  },

  // ---------------------------------------------------------------------------
  // document  (narrative facts; details is long-form)
  // ---------------------------------------------------------------------------
  {
    name: 'profile',
    description:
      'Canonical long-form profile for an entity. Consumed by MemorySystem.getContext. Keep the name as-is.',
    category: 'document',
    payloadKind: 'narrative',
    defaultImportance: 1.0,
    rankingWeight: 1.0,
  },
  {
    name: 'biography',
    description: 'Background narrative about a person.',
    category: 'document',
    payloadKind: 'narrative',
    subjectTypes: ['person'],
    defaultImportance: 0.8,
    rankingWeight: 1.0,
  },
  {
    name: 'memo',
    description: 'Short written memo or note.',
    category: 'document',
    payloadKind: 'narrative',
    defaultImportance: 0.6,
    rankingWeight: 1.0,
  },
  {
    name: 'meeting_notes',
    description: 'Notes captured during a meeting.',
    category: 'document',
    payloadKind: 'narrative',
    defaultImportance: 0.7,
    rankingWeight: 1.0,
  },
  {
    name: 'research_note',
    description: 'Research or investigation note.',
    category: 'document',
    payloadKind: 'narrative',
    defaultImportance: 0.6,
    rankingWeight: 1.0,
  },

  // ---------------------------------------------------------------------------
  // social
  // ---------------------------------------------------------------------------
  {
    name: 'knows',
    description: 'Subject knows object personally or professionally.',
    category: 'social',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    objectTypes: ['person'],
    defaultImportance: 0.5,
    rankingWeight: 0.8,
  },
  {
    name: 'works_with',
    description: 'Ongoing working relationship (colleague, collaborator).',
    category: 'social',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    objectTypes: ['person'],
    defaultImportance: 0.6,
    rankingWeight: 0.9,
  },
  {
    name: 'colleague_of',
    description: 'Peer relationship within the same organization.',
    category: 'social',
    payloadKind: 'relational',
    subjectTypes: ['person'],
    objectTypes: ['person'],
    defaultImportance: 0.5,
    rankingWeight: 0.8,
  },
];
