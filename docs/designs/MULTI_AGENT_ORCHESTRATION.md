# Multi-Agent Orchestration Design

**Status**: Draft — Design Exploration
**Created**: 2026-03-13
**Context**: Extends existing Agent/BaseAgent/AgentContextNextGen architecture
**Related**: `AGENT_ORCHESTRATOR_PLAN.md` (task routing focus — this document focuses on goal-oriented workflows)

---

## Table of Contents

1. [Motivation](#1-motivation)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [Orchestration Approaches](#3-orchestration-approaches)
4. [Shared Context Approaches](#4-shared-context-approaches)
5. [Recommended Architecture](#5-recommended-architecture)
6. [Core Components](#6-core-components)
7. [Artifact System](#7-artifact-system)
8. [Worker Lifecycle & Communication](#8-worker-lifecycle--communication)
9. [Interface Definitions](#9-interface-definitions)
10. [Integration with Existing Architecture](#10-integration-with-existing-architecture)
11. [Usage Examples](#11-usage-examples)
12. [Implementation Phases](#12-implementation-phases)
13. [Open Questions](#13-open-questions)

---

## 1. Motivation

### Current State

- `Agent` handles single-agent workflows well: agentic loop, tool execution, context management
- `PlanningAgent` demonstrates agent composition (wraps Agent, adds planning tools)
- No framework for multiple agents collaborating toward a shared goal
- No structured way to share work products between agents
- No pattern for plan → implement → review → revise cycles

### What We Need

A system where an **orchestrator agent** coordinates **worker agents** (planners, implementers, reviewers) that:
- Work on different aspects of a complex goal
- Share structured work products (artifacts)
- Can run in parallel where dependencies allow
- Follow structured phases but adapt dynamically
- Don't blow each other's context windows with irrelevant data

### How This Differs from AGENT_ORCHESTRATOR_PLAN.md

The prior orchestrator design focuses on **task routing** — matching incoming tasks to the right agent type from a pool. This document focuses on **goal-oriented collaboration** — multiple agents with defined roles working together on a single complex goal through structured phases.

| Aspect | Prior Design (Routing) | This Design (Collaboration) |
|--------|----------------------|---------------------------|
| Primary concern | Which agent handles this task? | How do agents work together? |
| Agent relationship | Independent, pooled | Collaborative, role-based |
| Communication | Via scoped memory (key-value) | Via typed artifacts + shared context |
| Orchestrator | Code-driven router | LLM-driven coordinator |
| Typical workflow | User message → route → single agent responds | Goal → plan → implement → review → deliver |
| Complementary? | **Yes** — routing picks the orchestrator, orchestrator manages workers |

---

## 2. Goals & Non-Goals

### Goals

1. **Structured collaboration**: Agents with defined roles (planner, implementer, reviewer) working on a shared goal
2. **Artifact-based communication**: Typed, versioned work products as the primary data contract between agents
3. **LLM-driven orchestration**: Orchestrator agent makes nuanced coordination decisions
4. **Parallel execution**: Independent tasks can run concurrently
5. **Phase structure**: Ordered phases with rules, but orchestrator can adapt dynamically
6. **Context isolation**: Each worker has a private context; only artifacts are shared
7. **Fits existing architecture**: Builds on Agent, AgentContextNextGen, plugin system
8. **Progressive complexity**: Simple cases stay simple, complex workflows are possible

### Non-Goals (v1)

1. **Distributed execution** — all agents run in-process (future: remote workers)
2. **Persistent multi-session workflows** — workflow state doesn't survive process restart (future: checkpoint/resume)
3. **Dynamic role creation** — roles are defined at workflow creation (future: orchestrator creates new roles)
4. **Nested orchestrators** — one level of orchestration only (future: hierarchical)
5. **Agent marketplace** — no dynamic agent discovery

---

## 3. Orchestration Approaches

Four approaches explored, ordered by increasing sophistication. Each has valid use cases.

### 3.1 Approach A: Tool-Based Delegation (Simplest)

The orchestrator is a regular `Agent` with special delegation tools. No new abstractions needed.

```
Orchestrator Agent (regular Agent + delegation tools)
  ├── delegate_task(role, prompt, tools[]) → spawns Agent, runs it, returns result
  ├── check_progress(taskId) → polls running agent
  └── collect_results(taskIds[]) → gathers outputs
```

**How it works:**
1. User creates a regular Agent with delegation tools registered
2. Agent's LLM decides when/what to delegate
3. Each delegation creates a fresh Agent, runs it to completion, returns result as tool output
4. Orchestrator's LLM sees delegation results and decides next steps

**Implementation complexity:** Minimal — just a set of ToolFunction definitions.

```typescript
// Usage
const agent = Agent.create({
  connector: 'anthropic',
  model: 'claude-sonnet-4-6',
  tools: [delegateTaskTool, checkProgressTool, collectResultsTool],
  instructions: 'You coordinate work by delegating to specialized workers...',
});

const result = await agent.run('Build a REST API for user management');
```

**Strengths:**
- Zero new abstractions — works with existing Agent
- LLM has full control over delegation strategy
- Easy to understand and debug
- Good for simple 2-3 step workflows

**Weaknesses:**
- No shared memory between sub-agents — everything passes through tool results
- No parallel execution — each delegation blocks the orchestrator's loop iteration
- Sub-agent results must fit in tool result (context window pressure)
- No structured plan enforcement — LLM can go off-rails
- No artifact versioning or typing
- Sub-agents are fully ephemeral — no accumulated context

**Best for:** Quick prototyping, simple delegation chains, when you want to add multi-agent to an existing Agent with minimal changes.

---

### 3.2 Approach B: Orchestrator Subclass + Worker Pool

A new `OrchestratorAgent extends Agent` with a `WorkerPool` of pre-configured sub-agents and a `PlanPlugin` for structured plan tracking.

```
OrchestratorAgent (extends Agent)
  ├── PlanPlugin (context plugin — plan visible in LLM context)
  │     └── Steps[], dependencies, status tracking
  ├── WorkerPool
  │     ├── "planner" → Agent config (planning-focused prompt, no filesystem tools)
  │     ├── "implementer" → Agent config (code tools, memory access)
  │     └── "reviewer" → Agent config (read-only tools, review prompt)
  └── Orchestration tools (injected automatically):
        ├── assign_step(stepId, workerRole, prompt) → runs worker, updates plan
        ├── run_parallel(assignments[]) → Promise.all on multiple workers
        ├── review_step(stepId, reviewerRole) → reviewer checks output
        └── revise_plan(changes) → update PlanPlugin
```

**How it works:**
1. `OrchestratorAgent.create()` takes role definitions and optional phase config
2. PlanPlugin injects current plan state into orchestrator's context
3. Orchestrator LLM calls `assign_step` to delegate work to a role
4. Worker pool creates/reuses Agent instances for each role
5. Workers have a `SharedContextPlugin` that gives them scoped read access to artifacts
6. Worker results become artifacts; orchestrator sees updated plan state

**Implementation complexity:** Moderate — new Agent subclass, PlanPlugin, WorkerPool, SharedContextPlugin.

```typescript
const orchestrator = OrchestratorAgent.create({
  connector: 'anthropic',
  model: 'claude-sonnet-4-6',
  workers: {
    planner:      { model: 'claude-sonnet-4-6', instructions: '...', tools: [] },
    implementer:  { model: 'claude-sonnet-4-6', instructions: '...', tools: [filesystem, bash] },
    reviewer:     { model: 'claude-sonnet-4-6', instructions: '...', tools: [filesystem] },
  },
  plan: { maxSteps: 20, requireReview: true },
});

const result = await orchestrator.run('Build a REST API for user management');
```

**Strengths:**
- Structured plan tracking visible in LLM context
- Parallel execution via `run_parallel`
- Shared artifacts between workers
- Workers are configurable (different models, tools, instructions per role)
- PlanPlugin is independently useful (even without multi-agent)

**Weaknesses:**
- Workers are still ephemeral per-step (no persistent context across assignments)
- Phase transitions are implicit (LLM decides)
- No formal artifact schemas — artifacts are untyped
- Shared memory scope is flat (no team/private hierarchy)

**Best for:** Goal-oriented workflows with clear role separation. The recommended starting point.

---

### 3.3 Approach C: Declarative Pipeline (No LLM Orchestrator)

A **code-defined pipeline** with typed stages. The orchestrator is deterministic code, not an LLM. Each stage runs one or more Agents.

```typescript
const pipeline = Pipeline.create({
  stages: [
    {
      name: 'plan',
      agent: { model: 'claude-sonnet-4-6', instructions: '...' },
      output: 'plan',
      outputSchema: PlanArtifactSchema,
    },
    {
      name: 'implement',
      agent: { model: 'claude-sonnet-4-6', instructions: '...', tools: [filesystem, bash] },
      input: ['plan'],
      output: 'code',
      outputSchema: CodeArtifactSchema,
      parallel: true,  // Fan out over plan steps
    },
    {
      name: 'review',
      agent: { model: 'claude-sonnet-4-6', instructions: '...' },
      input: ['plan', 'code'],
      output: 'review',
      outputSchema: ReviewArtifactSchema,
    },
    {
      name: 'revise',
      agent: { model: 'claude-sonnet-4-6', instructions: '...', tools: [filesystem, bash] },
      input: ['review', 'code'],
      output: 'code',
      condition: (ctx) => ctx.artifact('review').content.hasIssues,
    },
  ],
  maxCycles: 3,  // review → revise loop limit
});

const result = await pipeline.execute('Build a REST API for user management');
```

**How it works:**
1. Pipeline definition is a DAG of stages
2. Each stage specifies: agent config, input artifacts, output artifact, optional condition
3. Pipeline executor runs stages in dependency order
4. Artifacts are typed with schemas — stage must produce conforming output
5. Conditional stages enable loops (review → revise → re-review)
6. Parallel stages fan out over artifact contents (e.g., one implementer per plan step)

**Implementation complexity:** Moderate — pipeline executor, artifact store, stage runner, condition evaluator.

**Strengths:**
- Predictable, testable flow — no LLM orchestration overhead
- Typed artifact contracts between stages
- Easy to visualize and debug
- No orchestrator token cost
- Natural parallel fan-out
- Good for well-defined, repeatable workflows (CI/CD-like)

**Weaknesses:**
- Not adaptive — can't dynamically add stages or change strategy mid-execution
- Plan stage output must be structured enough for downstream parsing
- Condition logic is limited to code predicates (not LLM judgment)
- Difficult to handle unexpected situations (agent gets stuck, needs clarification)
- No human-in-the-loop (unless stage explicitly supports it)
- Poor for exploratory or research-heavy tasks

**Best for:** Well-defined production workflows. Code review pipelines, content generation pipelines, data processing chains. Not for open-ended problem solving.

---

### 3.4 Approach D: Hybrid — LLM Orchestrator + Declarative Phases

Combines the structured phases of Approach C with the adaptive LLM orchestrator of Approach B. The orchestrator operates within a **phase framework** that provides structure while allowing dynamic decisions.

```
OrchestratorAgent (LLM-driven, phase-aware)
  │
  ├── PhaseManager (framework — enforces rules)
  │     ├── planning:       roles=[planner], artifacts=[plan], maxIter=5
  │     ├── implementation: roles=[implementer], artifacts=[code], parallel=true, maxIter=20
  │     ├── review:         roles=[reviewer], artifacts=[review], canTrigger=[revision]
  │     └── revision:       roles=[implementer], artifacts=[code], fallsBackTo=review
  │
  ├── ArtifactRegistry (typed, versioned shared state)
  │     ├── plan (v1, PlanSchema)
  │     ├── code (v3, CodeSchema)
  │     └── review (v2, ReviewSchema)
  │
  └── WorkerPool (role → Agent configs)
        ├── planner → Agent
        ├── implementer → Agent
        └── reviewer → Agent
```

**How it works:**
1. Phases define the structure: which roles participate, what artifacts are expected, iteration limits
2. The LLM orchestrator decides **within** each phase: specific task assignments, when to advance, whether to loop
3. PhaseManager enforces rules: only allowed roles can be assigned, only allowed transitions happen
4. Artifacts have schemas — workers must produce conforming output
5. Orchestrator advances phases when artifacts satisfy requirements
6. Workers get scoped artifact access based on phase + role

**The orchestrator LLM decides:**
- When a phase is "done" (artifacts satisfy requirements)
- Which specific sub-tasks to assign within a phase
- Whether to accept a review or request revision
- When to abort or change strategy
- How to handle unexpected situations

**The framework enforces:**
- Phase ordering and allowed transitions
- Which roles can act in which phase
- Artifact schemas (structured outputs)
- Resource limits per phase (max iterations, timeout)
- Automatic artifact passing between phases

**Implementation complexity:** High — all components from Approach B plus PhaseManager, artifact schemas, phase transition logic.

```typescript
const orchestrator = OrchestratorAgent.create({
  connector: 'anthropic',
  model: 'claude-opus-4-6',

  phases: {
    planning: {
      roles: ['planner'],
      expectedArtifacts: ['plan'],
      maxIterations: 5,
    },
    implementation: {
      roles: ['implementer'],
      expectedArtifacts: ['code'],
      parallel: true,
      maxIterations: 20,
    },
    review: {
      roles: ['reviewer'],
      expectedArtifacts: ['review'],
      canTrigger: ['revision'],
    },
    revision: {
      roles: ['implementer'],
      expectedArtifacts: ['code'],
      fallsBackTo: 'review',
    },
  },

  roles: {
    planner:      { model: 'claude-sonnet-4-6', instructions: '...', tools: [] },
    implementer:  { model: 'claude-sonnet-4-6', instructions: '...', tools: [filesystem, bash] },
    reviewer:     { model: 'claude-sonnet-4-6', instructions: '...', tools: [filesystem] },
  },

  artifacts: {
    plan:   { schema: PlanArtifactSchema },
    code:   { schema: CodeArtifactSchema },
    review: { schema: ReviewArtifactSchema },
  },
});

const result = await orchestrator.run('Build a REST API for user management');
```

**Strengths:**
- Structured yet adaptive — framework provides guardrails, LLM provides judgment
- Typed artifact contracts prevent data format mismatches
- Phase rules prevent runaway execution
- Natural parallel execution in implementation phases
- Orchestrator can handle unexpected situations (unlike pure pipeline)
- Auditable — phase transitions and artifact versions create clear trail

**Weaknesses:**
- Most complex to build
- Phase definitions add configuration overhead for simple cases
- Orchestrator LLM must understand phase semantics (prompt engineering)
- Artifact schemas require upfront design

**Best for:** Complex, multi-step workflows where you want structure but need adaptability. The eventual target architecture.

---

### 3.5 Approach Comparison

| Dimension | A: Tool-Based | B: Orchestrator+Pool | C: Pipeline | D: Hybrid |
|-----------|---------------|----------------------|-------------|-----------|
| **Complexity** | Minimal | Moderate | Moderate | High |
| **Orchestrator** | LLM (implicit) | LLM (explicit) | Code | LLM + framework |
| **Adaptability** | High (unstructured) | High | Low | High (bounded) |
| **Parallel exec** | No | Yes | Yes | Yes |
| **Shared state** | Tool results only | Shared memory | Typed artifacts | Typed artifacts |
| **Plan tracking** | None | PlanPlugin | Stage DAG | PhaseManager |
| **Guardrails** | None | Soft (plan plugin) | Hard (pipeline) | Medium (phases) |
| **Context isolation** | Full (ephemeral workers) | Partial (shared memory) | Partial (artifacts) | Scoped (role+phase) |
| **Token overhead** | Low | Medium | Low | Medium-High |
| **Build effort** | Days | 1-2 weeks | 1 week | 3-4 weeks |
| **Best for** | Prototyping | Recommended start | Production pipelines | Complex workflows |

### Recommended Path

**Build B first**, design interfaces so they evolve into D:

1. **Phase 1**: PlanPlugin + ArtifactRegistry + WorkerPool → Approach B
2. **Phase 2**: Add artifact schemas + SharedContextPlugin → B+
3. **Phase 3**: Add PhaseManager as optional configuration layer → Approach D
4. **Keep Approach A available** as the zero-config option (just delegation tools)
5. **Keep Approach C available** as Pipeline utility for deterministic workflows

---

## 4. Shared Context Approaches

The central design question: **how do agents share work products and knowledge?**

### 4.1 The Data Flow Problem

Data flows in four directions between agents:

**Downward (Orchestrator → Worker):**
- Task assignment: what to do, constraints, acceptance criteria
- Relevant context from prior steps: plan excerpts, code produced so far
- Global instructions / project conventions
- Identity of other workers and what they've done

**Upward (Worker → Orchestrator):**
- Task result: success/failure, output artifacts
- Structured status: progress, blockers, confidence level
- Requests: need more info, need different tools, need to escalate
- Execution metadata: tokens used, iterations, tool calls made

**Lateral (Worker → Worker):**
- Usually **read-only**: implementer reads planner's output, reviewer reads implementer's code
- True bidirectional worker communication is rare — usually means the orchestrator should be mediating
- Exception: parallel implementers working on related modules might need to coordinate

**Persistent (survives the entire workflow):**
- Final artifacts: plan, code, review
- Decisions made and rationale
- Accumulated knowledge about the problem domain

### 4.2 What Should NOT Be Shared

Equally important — what stays private to each worker:

| Private Data | Why Private |
|-------------|-------------|
| Worker's internal reasoning | Chain of thought, false starts — only final result matters |
| Worker's conversation history | The 15-iteration LLM back-and-forth is noise to others |
| Tool execution details | Orchestrator doesn't need every `read_file` call |
| Worker's working memory | Ephemeral scratch space for the worker's own use |
| Failed attempts | Worker learns from failures but shouldn't pollute others |

**Key insight**: Each worker's `AgentContextNextGen` remains entirely private. Shared state flows exclusively through the `ArtifactRegistry`, not by exposing contexts.

### 4.3 Shared Context Model A: Shared Mutable Memory

All agents read/write from a single shared key-value store. Like a shared filesystem.

```
┌─────────────────────────────────────┐
│          SharedMemoryStore          │
│  ┌──────┐  ┌──────┐  ┌──────────┐  │
│  │ plan │  │ code │  │decisions │  │
│  └──────┘  └──────┘  └──────────┘  │
└─────┬─────────┬──────────┬──────────┘
      │         │          │
  Orchestrator  Implementer  Reviewer
  (read/write)  (read/write)  (read only)
```

```typescript
// Any agent can write
sharedMemory.set('plan', planData);

// Any agent can read
const plan = sharedMemory.get('plan');

// Query
const all = sharedMemory.list();
```

**Strengths:**
- Simple mental model
- Workers can discover what's available
- No marshaling/serialization between agents
- Low coordination overhead

**Weaknesses:**
- Race conditions with parallel workers writing to same keys
- No clear ownership — who last wrote `code`?
- Hard to know what changed between reads
- Unbounded growth — workers might dump everything in
- No structure — a string and a 50K-line codebase use the same interface
- Context window pressure — worker might try to read everything

**Verdict:** Too loose for production use. Works for Approach A prototyping.

---

### 4.4 Shared Context Model B: Explicit Artifact Passing

The orchestrator explicitly decides what each worker sees. Nothing is implicitly shared.

```
Orchestrator
  │
  ├── assign(planner, { input: goal })
  │     └── returns: { artifacts: { plan: {...} } }
  │
  ├── assign(implementer, { input: { plan } })  ← orchestrator passes plan explicitly
  │     └── returns: { artifacts: { code: {...} } }
  │
  └── assign(reviewer, { input: { plan, code } })  ← orchestrator passes both
        └── returns: { artifacts: { review: {...} } }
```

```typescript
// Orchestrator controls what each worker sees
const planResult = await workerPool.assign('planner', {
  prompt: 'Create a plan for: ...',
  inputArtifacts: {},  // planner sees nothing
});

const codeResult = await workerPool.assign('implementer', {
  prompt: 'Implement step 3 of the plan',
  inputArtifacts: { plan: planResult.artifacts.plan },  // explicit pass
});
```

**Strengths:**
- Crystal-clear data flow — you can trace exactly what each worker saw
- Orchestrator controls visibility — no accidental information leakage
- No race conditions — orchestrator is the single writer
- Auditable — every artifact pass is logged

**Weaknesses:**
- Orchestrator becomes a bottleneck for all data flow
- Large artifacts get serialized through orchestrator's context (context pressure)
- Orchestrator must understand what's relevant for each worker
- Workers can't discover additional artifacts they might need

**Verdict:** Too rigid. Good for Approach C (Pipeline) but limiting for LLM-driven orchestration.

---

### 4.5 Shared Context Model C: Artifact Registry with Scoped Views (Recommended)

**Hybrid approach.** Artifacts are the primary contract. Workers get **scoped read views** of the registry — they can discover and pull what they need, within their allowed scope.

```
┌──────────────────────────────────────────────────┐
│                 ArtifactRegistry                  │
│  ┌──────────────────────────────────────────────┐ │
│  │  plan (v1)   │  code (v3)   │  review (v2)  │ │
│  │  .summary    │  .summary    │  .summary     │ │
│  │  .content    │  .content    │  .content     │ │
│  │  .schema     │  .schema     │  .schema      │ │
│  └──────────────────────────────────────────────┘ │
│  publish() / get() / query() / list()             │
│  version tracking, change log, access control     │
└──────────┬───────────┬───────────┬────────────────┘
           │           │           │
    ┌──────┴───┐ ┌─────┴─────┐ ┌──┴─────────┐
    │Orchestr. │ │Implementer│ │  Reviewer   │
    │          │ │           │ │             │
    │PlanPlugin│ │SharedCtx  │ │SharedCtx    │
    │(r/w all) │ │Plugin     │ │Plugin       │
    │          │ │(r: plan,  │ │(r: plan,    │
    │          │ │  review   │ │  code       │
    │          │ │ w: code)  │ │ w: review)  │
    └──────────┘ └───────────┘ └─────────────┘
```

#### 4.5.1 Layered Access (Solves Context Window Pressure)

The biggest practical problem: a code artifact might be 50K tokens. A plan artifact might be 2K. You can't inject everything into every worker's context. Solution: **three layers of access**.

```
Layer 1: Summary (always in context — injected by SharedContextPlugin)
  "code: 5 files implementing user API, 847 lines total"
  "plan: 7-step implementation plan, 3 steps completed"
  Cost: ~50-200 tokens per artifact

Layer 2: Index (on demand — via artifact_query tool)
  artifact_query('code', 'files') → ["src/api/users.ts", "src/api/auth.ts", ...]
  artifact_query('code', 'files[0].exports') → ["createUser", "getUser", "updateUser"]
  artifact_query('plan', 'steps[2]') → { description: "...", status: "done", ... }
  Cost: varies, but targeted

Layer 3: Full Content (on demand — via artifact_get tool)
  artifact_get('code', { file: 'src/api/users.ts' }) → full file content
  artifact_get('plan') → full plan
  Cost: full artifact size, but worker explicitly chose to load it
```

This means the LLM always knows **what exists** (summaries are free), can **explore structure** cheaply (queries), and **loads full content** only when needed.

#### 4.5.2 Scoped Permissions

Each worker role gets a scope that defines read/write access:

```typescript
interface WorkerScope {
  role: string;
  phase?: string;  // Optional phase-awareness (for Approach D)

  readable: string[];   // Artifact keys this worker can read
  writable: string[];   // Artifact keys this worker can publish/update

  // Derived from role config, not set per-assignment
}

// Example scopes:
//   planner:      read: [goal],           write: [plan]
//   implementer:  read: [plan, review],   write: [code]
//   reviewer:     read: [plan, code],     write: [review]
```

**Why scope matters:**
- Prevents reviewer from seeing prior reviews (avoids bias anchoring)
- Prevents planner from seeing implementation details (stays high-level)
- Security: workers don't access artifacts outside their mandate
- Token budget: workers don't accidentally load irrelevant artifacts

#### 4.5.3 Artifact Structure

Artifacts need internal structure for Layer 2 queries to work:

```typescript
interface Artifact<T = unknown> {
  // Identity
  key: string;                    // Unique identifier (e.g., 'plan', 'code', 'review')
  type: ArtifactType;             // 'plan' | 'code' | 'review' | 'data' | 'text' | 'custom'

  // Content
  summary: string;                // Always present, always short (~100 tokens max)
  content: T;                     // The actual structured data

  // Metadata
  producer: string;               // Which role created this
  phase?: string;                 // Which phase it was created in
  version: number;                // Incremented on each update
  tokens: number;                 // Estimated token cost of full content
  createdAt: Date;
  updatedAt: Date;

  // Schema (optional, for Approach D)
  schema?: JSONSchema;            // Expected structure of content
}
```

**Typed artifact examples:**

```typescript
// Plan artifact
interface PlanContent {
  goal: string;
  approach: string;
  steps: Array<{
    id: string;
    description: string;
    status: 'pending' | 'in_progress' | 'done' | 'failed';
    assignedRole?: string;
    dependencies: string[];
    acceptanceCriteria: string[];
    estimatedComplexity: 'low' | 'medium' | 'high';
  }>;
  constraints: string[];
  risks: string[];
}

// Code artifact
interface CodeContent {
  files: Array<{
    path: string;
    content: string;
    language: string;
    summary: string;
    exports?: string[];
    dependencies?: string[];
  }>;
  totalLines: number;
  totalFiles: number;
  entryPoint?: string;
}

// Review artifact
interface ReviewContent {
  verdict: 'approved' | 'changes_requested' | 'rejected';
  overallAssessment: string;
  issues: Array<{
    severity: 'critical' | 'major' | 'minor' | 'suggestion';
    file?: string;
    line?: number;
    description: string;
    suggestedFix?: string;
  }>;
  strengths: string[];
  hasBlockingIssues: boolean;
}
```

#### 4.5.4 Versioning

When an artifact is updated (e.g., implementer revises code after review), the version increments:

```
v1: implementer publishes code artifact
    → orchestrator sees: code v1 available
v2: reviewer reads code v1, publishes review artifact
    → orchestrator sees: review v1, code v1
v3: implementer reads review v1, publishes code v2
    → orchestrator sees: code v2, review v1
v4: reviewer reads code v2, publishes review v2
    → orchestrator sees: code v2, review v2
```

The orchestrator's PlanPlugin surfaces changes:

```
## Artifact Updates
- code v1→v2 (implementer): Fixed validation logic per review feedback
- review v2 (reviewer): Approved with minor suggestions
```

**Design decisions:**
- Simple version counter (no CRDT/merge needed — orchestrator ensures single writer per artifact at a time)
- Previous versions are kept for audit trail but not loaded into context by default
- Change summaries are required when updating an artifact

```typescript
interface ArtifactUpdate {
  key: string;
  version: number;
  previousVersion: number;
  changedBy: string;
  changeSummary: string;     // Worker describes what changed
  timestamp: Date;
}
```

#### 4.5.5 Comparison of Shared Context Models

| Dimension | A: Shared Mutable | B: Explicit Passing | C: Artifact Registry |
|-----------|-------------------|--------------------|--------------------|
| **Access model** | Any agent, any key | Orchestrator passes | Scoped views per role |
| **Discovery** | Full visibility | Only what's passed | Summaries always visible |
| **Context pressure** | High (agents read everything) | Medium (orchestrator selects) | Low (layered: summary → query → full) |
| **Race conditions** | Yes | No | No (single writer enforced) |
| **Ownership** | Unclear | Clear (orchestrator) | Clear (producer role) |
| **Flexibility** | High (too high) | Low | Medium (scoped but autonomous) |
| **Auditability** | Low | High | High (version + change log) |
| **Implementation** | Simple | Simple | Moderate |
| **Scales to large artifacts** | No | Partially | Yes (layered access) |

---

## 5. Recommended Architecture

Based on the exploration above, the recommended architecture combines **Approach B** (Orchestrator subclass + WorkerPool) with **Shared Context Model C** (Artifact Registry with scoped views), designed to evolve into **Approach D** (Hybrid phases).

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OrchestratorAgent                            │
│                     (extends Agent)                                  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    Orchestrator's Context                       │ │
│  │  ┌──────────┐  ┌──────────────┐  ┌───────────────────────────┐ │ │
│  │  │ System   │  │ PlanPlugin   │  │ Other plugins (memory,    │ │ │
│  │  │ Prompt   │  │ (plan state  │  │ in-context memory, etc.)  │ │ │
│  │  │          │  │ + artifacts) │  │                           │ │ │
│  │  └──────────┘  └──────────────┘  └───────────────────────────┘ │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │ Orchestration Tools: assign_step, run_parallel,          │  │ │
│  │  │   advance_phase, revise_plan, request_human_input        │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌──────────────┐  ┌──────────────────────────────────────────────┐ │
│  │  WorkerPool  │  │           ArtifactRegistry                   │ │
│  │              │  │  ┌──────┐ ┌──────┐ ┌────────┐ ┌──────────┐  │ │
│  │  planner ────│──│─▶│ plan │ │ code │ │ review │ │ metrics  │  │ │
│  │  implementer │  │  │  v1  │ │  v3  │ │  v2    │ │   v1     │  │ │
│  │  reviewer ───│──│─▶│      │ │      │ │        │ │          │  │ │
│  │              │  │  └──────┘ └──────┘ └────────┘ └──────────┘  │ │
│  └──────────────┘  └──────────────────────────────────────────────┘ │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              PhaseManager (optional, for Approach D)          │   │
│  │  planning → implementation → review ⟲ revision               │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘

         Worker Agent (private context, scoped artifact access)
┌─────────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Worker's AgentContextNextGen (PRIVATE)                      │   │
│  │  ┌────────────┐  ┌──────────────────┐  ┌──────────────────┐ │   │
│  │  │ System     │  │ SharedContext     │  │ WorkingMemory    │ │   │
│  │  │ Prompt     │  │ Plugin           │  │ Plugin (private) │ │   │
│  │  │ (role-     │  │ (artifact        │  │                  │ │   │
│  │  │  specific) │  │  summaries +     │  │                  │ │   │
│  │  │            │  │  get/query tools)│  │                  │ │   │
│  │  └────────────┘  └──────────────────┘  └──────────────────┘ │   │
│  │  ┌──────────────────────────────────────────────────────────┐│   │
│  │  │ Worker's tools (filesystem, bash, etc.) + artifact tools ││   │
│  │  └──────────────────────────────────────────────────────────┘│   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Core Components

### 6.1 OrchestratorAgent

Extends `Agent` with multi-agent coordination capabilities. Its agentic loop is the standard Agent loop — the orchestration happens through specialized tools.

**Responsibilities:**
- Configure and manage WorkerPool
- Own the ArtifactRegistry
- Inject PlanPlugin into its own context
- Provide orchestration tools (assign_step, run_parallel, etc.)
- Track workflow state and metrics
- Handle worker errors and retries

**What it inherits from Agent:**
- Full agentic loop (iterations, tool calling, hooks)
- Context management (AgentContextNextGen)
- Streaming support
- Session persistence
- Permission management

**What it adds:**
- `WorkerPool` management
- `ArtifactRegistry` ownership
- `PlanPlugin` auto-registration
- Orchestration tool auto-injection
- Optional `PhaseManager`

### 6.2 WorkerPool

Manages worker Agent instances by role. Handles creation, reuse, and cleanup.

**Design decisions:**
- Workers are created lazily on first assignment
- Workers can be reused across assignments (configurable)
- Each worker gets a private `AgentContextNextGen` with `SharedContextPlugin`
- Worker creation follows role config (model, instructions, tools, scope)

```typescript
class WorkerPool implements IDisposable {
  // Configuration
  registerRole(name: string, config: WorkerRoleConfig): void;
  getRoleConfig(name: string): WorkerRoleConfig | undefined;
  listRoles(): string[];

  // Assignment
  async assign(role: string, task: WorkerTask): Promise<WorkerResult>;
  async assignParallel(assignments: WorkerAssignment[]): Promise<WorkerResult[]>;

  // Instance management
  getWorker(role: string): Agent | undefined;
  resetWorker(role: string): void;  // Clear worker's context for fresh start
  listActiveWorkers(): WorkerInfo[];

  // Lifecycle
  destroy(): void;
}
```

**Worker reuse strategy:**
- Default: **reset per assignment** — worker's conversation is cleared between tasks, but SharedContextPlugin persists artifact access
- Optional: **persistent workers** — worker retains conversation history across assignments (useful for implementer building on prior work)
- Configurable per role

### 6.3 ArtifactRegistry

Centralized store for typed, versioned work products shared between agents.

```typescript
class ArtifactRegistry {
  // Publishing
  publish(key: string, artifact: ArtifactInput): Artifact;
  update(key: string, content: unknown, changeSummary: string): Artifact;

  // Reading
  get(key: string): Artifact | null;
  getSummary(key: string): ArtifactSummary | null;
  query(key: string, path: string): unknown;  // JSONPath-style query into content
  list(): ArtifactSummary[];

  // History
  getVersion(key: string, version: number): Artifact | null;
  getHistory(key: string): ArtifactUpdate[];
  getChangeLog(): ArtifactUpdate[];  // All changes, chronological

  // Schema validation (optional)
  registerSchema(artifactKey: string, schema: JSONSchema): void;
  validate(key: string, content: unknown): ValidationResult;

  // Lifecycle
  clear(): void;
  delete(key: string): void;
}
```

### 6.4 PlanPlugin (Context Plugin for Orchestrator)

A new `IContextPluginNextGen` that injects plan state and artifact summaries into the orchestrator's context.

```typescript
class PlanPlugin extends BasePluginNextGen {
  name = 'orchestrator_plan';

  // What the orchestrator LLM sees in its system message
  getInstructions(): string {
    return `You are an orchestrator managing a multi-agent workflow.
Use assign_step to delegate work to workers.
Use run_parallel for independent tasks.
Monitor artifact updates and advance the plan accordingly.`;
  }

  // Injected into orchestrator's context before each LLM call
  async getContent(): Promise<string | null> {
    return [
      this.renderPlanState(),        // Current plan steps + statuses
      this.renderArtifactIndex(),    // Available artifacts with summaries
      this.renderRecentChanges(),    // Recent artifact updates
      this.renderWorkerStatus(),     // Active workers and their current tasks
    ].filter(Boolean).join('\n\n');
  }

  // Tools provided to the orchestrator
  getTools(): ToolFunction[] {
    return [
      this.assignStepTool,
      this.runParallelTool,
      this.revisePlanTool,
      this.advancePhaseTool,       // Optional (for Approach D)
      this.requestHumanInputTool,  // For human-in-the-loop
    ];
  }
}
```

**What the orchestrator's context looks like:**

```
## System Prompt
You are an orchestrator managing a multi-agent workflow...

## Current Plan
Goal: Build a REST API for user management

| Step | Description | Status | Assigned | Dependencies |
|------|------------|--------|----------|-------------|
| 1 | Design API schema | done | planner | - |
| 2 | Implement user endpoints | in_progress | implementer | 1 |
| 3 | Add authentication | pending | - | 2 |
| 4 | Write tests | pending | - | 2, 3 |
| 5 | Code review | pending | reviewer | 2, 3, 4 |

## Available Artifacts
- **plan** (planner, v1): 5-step implementation plan for user management REST API
- **code** (implementer, v1): 3 files, 247 lines — user CRUD endpoints [IN PROGRESS]

## Recent Changes
- [12:03] plan v1 published by planner: Initial 5-step plan
- [12:05] code v1 published by implementer: User CRUD endpoints (steps 1-2)

## Worker Status
- planner: idle
- implementer: working on step 2 (iteration 7/20)
- reviewer: idle
```

### 6.5 SharedContextPlugin (Context Plugin for Workers)

A new `IContextPluginNextGen` that gives workers scoped access to the ArtifactRegistry.

```typescript
class SharedContextPlugin extends BasePluginNextGen {
  name = 'shared_context';

  constructor(
    private registry: ArtifactRegistry,
    private scope: WorkerScope,
  ) {}

  getInstructions(): string {
    return `You have access to shared artifacts from the project workflow.
Artifact summaries are shown below. Use artifact_get(key) to load full content
or artifact_query(key, path) to explore structure.`;
  }

  // Inject artifact summaries into worker's context
  async getContent(): Promise<string | null> {
    const artifacts = this.registry.list()
      .filter(a => this.scope.readable.includes(a.key));

    if (!artifacts.length) return null;

    return `## Available Artifacts\n${
      artifacts.map(a =>
        `- **${a.key}** (${a.producer}, v${a.version}): ${a.summary} [${a.tokens} tokens]`
      ).join('\n')
    }`;
  }

  getTools(): ToolFunction[] {
    return [
      this.artifactGetTool(),     // Load full artifact content
      this.artifactQueryTool(),   // JSONPath query into artifact
      this.artifactPublishTool(), // Publish/update artifact (if writable)
    ];
  }
}
```

---

## 7. Artifact System

### 7.1 Artifact Lifecycle

```
              publish()                update()                update()
  Worker A ──────────▶ Artifact v1 ──────────▶ v2 ──────────▶ v3
                          │                     │                │
                     Other workers         Other workers    Other workers
                     see summary           see summary      see summary
                     (auto-refresh)        + change log     + change log
```

**Creation:**
1. Worker calls `artifact_publish(key, content, summary)` tool
2. SharedContextPlugin validates scope (worker can write this key)
3. ArtifactRegistry stores artifact with version=1
4. PlanPlugin in orchestrator sees update on next `prepare()`

**Update:**
1. Worker calls `artifact_publish(key, content, summary, changeSummary)` tool
2. Registry increments version, stores change log entry
3. Previous version kept in history
4. Orchestrator's PlanPlugin surfaces the change

**Reading:**
1. Worker always sees summaries of readable artifacts (Layer 1, via SharedContextPlugin.getContent())
2. Worker calls `artifact_query(key, path)` for targeted data (Layer 2)
3. Worker calls `artifact_get(key)` for full content (Layer 3)

### 7.2 Built-in Artifact Types

| Type | Typical Content | Typical Size | Query Paths |
|------|----------------|-------------|-------------|
| `plan` | Steps, dependencies, criteria | 1-3K tokens | `steps`, `steps[i]`, `constraints` |
| `code` | Files with content and metadata | 5-50K tokens | `files`, `files[i].content`, `files[i].exports` |
| `review` | Verdict, issues, suggestions | 1-5K tokens | `verdict`, `issues`, `issues[i]` |
| `data` | Structured data (JSON/tables) | Variable | Any JSONPath |
| `text` | Unstructured text (reports, docs) | Variable | N/A (full content only) |
| `custom` | User-defined structure | Variable | User-defined |

### 7.3 Artifact Schemas (Optional, for Approach D)

When schemas are registered, artifacts are validated on publish:

```typescript
// Register schema
registry.registerSchema('plan', {
  type: 'object',
  required: ['goal', 'steps'],
  properties: {
    goal: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'description', 'status'],
        properties: {
          id: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'failed'] },
          // ...
        }
      }
    }
  }
});

// Publish validates against schema
registry.publish('plan', { content: invalidData });
// Throws: ArtifactValidationError
```

**When to use schemas:**
- Production workflows where artifact format matters
- When downstream consumers (other workers or code) parse artifacts programmatically
- When using Approach D phases with expected artifacts

**When to skip schemas:**
- Prototyping
- Open-ended exploratory workflows
- When artifacts are consumed by LLMs (which handle format variation well)

---

## 8. Worker Lifecycle & Communication

### 8.1 Worker Assignment Flow

```
Orchestrator LLM calls: assign_step("implementer", "Implement user endpoints", { plan: "plan" })
  │
  ▼
OrchestratorAgent.assignStep()
  │
  ├── 1. WorkerPool.assign("implementer", task)
  │     ├── Get or create Agent for "implementer" role
  │     ├── Create SharedContextPlugin with scope { readable: [plan, review], writable: [code] }
  │     ├── Inject task prompt + any explicit artifact content
  │     └── agent.run(taskPrompt)
  │           ├── Worker's agentic loop runs (iterations, tool calls)
  │           ├── Worker reads artifacts via SharedContextPlugin tools
  │           ├── Worker publishes artifacts via SharedContextPlugin tools
  │           └── Returns: WorkerResult { output, artifacts, metrics }
  │
  ├── 2. Update ArtifactRegistry with any new/updated artifacts
  │
  ├── 3. Update PlanPlugin (step status, assignment result)
  │
  └── 4. Return tool result to orchestrator LLM
        "Step 2 completed by implementer. Published: code v1 (3 files, 247 lines)"
```

### 8.2 Parallel Assignment Flow

```
Orchestrator LLM calls: run_parallel([
  { role: "implementer", prompt: "Implement users module", stepId: "2a" },
  { role: "implementer", prompt: "Implement auth module", stepId: "2b" },
])
  │
  ▼
OrchestratorAgent.runParallel()
  │
  ├── Create separate Agent instances for each assignment
  │   (even if same role — parallel workers need separate contexts)
  │
  ├── Promise.all([
  │     workerPool.assign("implementer", task2a),
  │     workerPool.assign("implementer", task2b),
  │   ])
  │
  ├── Collect all results + artifact updates
  │
  └── Return aggregated tool result to orchestrator LLM
```

**Parallel isolation:**
- Parallel workers get **separate** Agent instances (separate contexts)
- They share the same ArtifactRegistry (reads are safe in parallel)
- Writes to **different** artifact keys are safe
- Writes to the **same** artifact key: last write wins (orchestrator should avoid this via task design)

### 8.3 Worker Context Construction

When a worker is assigned a task, its context is built as follows:

```
Worker's System Prompt (from role config):
  "You are an expert code implementer. Write clean, tested code..."

SharedContextPlugin Content (auto-injected):
  ## Available Artifacts
  - plan (planner, v1): 5-step implementation plan [1200 tokens]
  - review (reviewer, v1): Changes requested, 3 issues [800 tokens]

SharedContextPlugin Instructions:
  "Use artifact_get(key) to load full artifacts,
   artifact_query(key, path) to explore structure."

WorkingMemory Plugin (worker's private scratch space):
  ## Working Memory
  (empty — fresh for each assignment, or persisted if worker reused)

Task Prompt (user message from orchestrator):
  "Implement step 2 of the plan: User CRUD endpoints.

   Key requirements from plan:
   - GET /users, POST /users, PUT /users/:id, DELETE /users/:id
   - Input validation with Zod
   - Error handling middleware

   Publish your code as the 'code' artifact when complete."
```

### 8.4 Worker Result Structure

```typescript
interface WorkerResult {
  // Core output
  output: string;           // Worker's final text response
  success: boolean;         // Whether the task completed successfully

  // Artifacts produced
  artifacts: {
    published: ArtifactSummary[];   // New artifacts created
    updated: ArtifactUpdate[];      // Existing artifacts updated
  };

  // Execution metadata
  metrics: {
    iterations: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
  };

  // Optional
  error?: string;          // Error message if !success
  blockers?: string[];     // Issues the worker couldn't resolve
}
```

### 8.5 Error Handling

| Error Type | Handling |
|-----------|---------|
| Worker hits max iterations | Return partial result, orchestrator decides retry/reassign |
| Worker tool failure | Worker's own circuit breaker handles; if persistent, return error |
| Worker produces invalid artifact | SharedContextPlugin validates; if schema fails, error returned |
| Worker timeout | OrchestratorAgent enforces overall timeout; kills worker, reports to LLM |
| All workers of a role fail | Orchestrator LLM gets error, can retry or escalate |

---

## 9. Interface Definitions

### 9.1 OrchestratorAgent Configuration

```typescript
interface OrchestratorAgentConfig extends AgentConfig {
  // Worker roles
  workers: Record<string, WorkerRoleConfig>;

  // Artifact configuration
  artifacts?: Record<string, ArtifactConfig>;

  // Phase configuration (optional — enables Approach D)
  phases?: Record<string, PhaseConfig>;

  // Orchestration limits
  orchestration?: {
    maxTotalIterations?: number;    // Across all workers (default: 200)
    maxWorkerIterations?: number;   // Per worker assignment (default: 50)
    maxParallelWorkers?: number;    // Concurrent workers (default: 5)
    workerTimeout?: number;         // Per worker timeout ms (default: 300000)
    maxArtifactSize?: number;       // Per artifact token limit (default: 50000)
    reuseWorkers?: boolean;         // Keep worker context between assignments (default: false)
  };
}

interface WorkerRoleConfig {
  // Agent configuration for this role
  connector?: string;              // Override orchestrator's connector
  model?: string;                  // Override orchestrator's model
  instructions: string;            // Role-specific system prompt
  tools?: ToolFunction[];          // Tools available to this role
  features?: ContextFeatures;      // Context features for worker

  // Scope
  scope: {
    readable: string[];            // Artifact keys this role can read
    writable: string[];            // Artifact keys this role can write
  };

  // Behavior
  maxIterations?: number;          // Override default max iterations
  temperature?: number;            // Override default temperature
  reuse?: boolean;                 // Override global reuseWorkers setting
}

interface ArtifactConfig {
  schema?: JSONSchema;             // Validation schema
  maxTokens?: number;              // Size limit for this artifact
  initialValue?: unknown;          // Pre-populated content
}

interface PhaseConfig {
  roles: string[];                 // Which roles can participate
  expectedArtifacts: string[];     // Artifacts expected to be produced
  maxIterations?: number;          // Iteration limit for this phase
  parallel?: boolean;              // Allow parallel worker assignments
  canTrigger?: string[];           // Phases this phase can transition to
  fallsBackTo?: string;            // After this phase, go to...
  entryCondition?: string;         // Human-readable condition for entering
}
```

### 9.2 ArtifactRegistry Interface

```typescript
interface IArtifactRegistry {
  // Publishing
  publish(key: string, input: ArtifactInput): Artifact;
  update(key: string, content: unknown, changeSummary: string, producer: string): Artifact;

  // Reading
  get(key: string): Artifact | null;
  getSummary(key: string): ArtifactSummary | null;
  query(key: string, path: string): unknown;
  list(): ArtifactSummary[];

  // History
  getVersion(key: string, version: number): Artifact | null;
  getHistory(key: string): ArtifactUpdate[];
  getChangeLog(since?: Date): ArtifactUpdate[];

  // Schema
  registerSchema(key: string, schema: JSONSchema): void;
  validate(key: string, content: unknown): ValidationResult;

  // Lifecycle
  clear(): void;
  delete(key: string): void;

  // Events
  onChange(handler: (update: ArtifactUpdate) => void): () => void;
}

interface ArtifactInput {
  type: ArtifactType;
  content: unknown;
  summary: string;
  producer: string;
  phase?: string;
}

interface ArtifactSummary {
  key: string;
  type: ArtifactType;
  summary: string;
  producer: string;
  phase?: string;
  version: number;
  tokens: number;
  createdAt: Date;
  updatedAt: Date;
}

type ArtifactType = 'plan' | 'code' | 'review' | 'data' | 'text' | 'custom';
```

### 9.3 WorkerPool Interface

```typescript
interface IWorkerPool extends IDisposable {
  // Role management
  registerRole(name: string, config: WorkerRoleConfig): void;
  getRoleConfig(name: string): WorkerRoleConfig | undefined;
  listRoles(): string[];

  // Assignment
  assign(role: string, task: WorkerTask): Promise<WorkerResult>;
  assignParallel(assignments: WorkerAssignment[]): Promise<WorkerResult[]>;

  // Instance management
  getWorker(role: string): Agent | undefined;
  resetWorker(role: string): void;
  listActiveWorkers(): WorkerInfo[];

  // Metrics
  getMetrics(): WorkerPoolMetrics;
}

interface WorkerTask {
  prompt: string;                     // Task description for the worker
  stepId?: string;                    // Plan step being worked on
  inputArtifacts?: Record<string, unknown>;  // Explicit artifact content to inject
  overrides?: Partial<WorkerRoleConfig>;     // Per-assignment overrides
}

interface WorkerAssignment {
  role: string;
  task: WorkerTask;
}

interface WorkerInfo {
  role: string;
  agentId: string;
  status: 'idle' | 'working' | 'error';
  currentTask?: string;
  iterationCount: number;
  totalTokens: number;
}
```

### 9.4 PhaseManager Interface (Approach D)

```typescript
interface IPhaseManager {
  // Configuration
  registerPhase(name: string, config: PhaseConfig): void;
  getPhaseConfig(name: string): PhaseConfig | undefined;
  listPhases(): string[];

  // State
  getCurrentPhase(): string | null;
  getPhaseHistory(): PhaseTransition[];

  // Transitions
  canAdvanceTo(phase: string): boolean;
  advance(toPhase: string, reason: string): void;
  canTrigger(fromPhase: string, toPhase: string): boolean;

  // Validation
  validateAssignment(role: string, phase: string): boolean;  // Can this role work in this phase?
  validateArtifact(key: string, phase: string): boolean;      // Expected in this phase?
  isPhaseComplete(phase: string): boolean;                    // All expected artifacts present?
}

interface PhaseTransition {
  from: string | null;
  to: string;
  reason: string;
  timestamp: Date;
  artifactsAtTransition: ArtifactSummary[];
}
```

---

## 10. Integration with Existing Architecture

### 10.1 How OrchestratorAgent Fits

```
Existing class hierarchy:
  BaseAgent (abstract)
    └── Agent (agentic loop)

New:
  BaseAgent (abstract)
    └── Agent (agentic loop)
         └── OrchestratorAgent (multi-agent coordination)
```

`OrchestratorAgent` extends `Agent`, not `BaseAgent`. It uses the full agentic loop — the orchestrator LLM calls tools (assign_step, run_parallel) that internally create and run worker Agents. No changes to Agent or BaseAgent needed.

### 10.2 Plugin Integration

| Plugin | Role in Orchestration |
|--------|----------------------|
| **PlanPlugin** (NEW) | Orchestrator only — injects plan state + artifact index |
| **SharedContextPlugin** (NEW) | Workers only — injects artifact summaries + access tools |
| **WorkingMemoryPlugin** (existing) | Both — private scratch space per agent |
| **InContextMemoryPlugin** (existing) | Both — private in-context state per agent |
| **PersistentInstructionsPlugin** (existing) | Optional — orchestrator might have persistent instructions |
| **ToolCatalogPlugin** (existing) | Workers — can scope available tools per role |

### 10.3 ToolManager Integration

- Orchestrator's ToolManager has orchestration tools (assign_step, etc.) + any user-added tools
- Worker's ToolManager has role-specific tools + artifact access tools from SharedContextPlugin
- No ToolManager sharing between orchestrator and workers — each has its own instance

### 10.4 StorageRegistry Integration

New storage keys for orchestration:

```typescript
StorageRegistry.configure({
  // Existing...
  sessions: (agentId) => new FileContextStorage(agentId),

  // New (optional)
  artifacts: () => new InMemoryArtifactStorage(),  // Default: in-memory
  workflowState: (orchestratorId) => new FileWorkflowStorage(orchestratorId),
});
```

### 10.5 Streaming Integration

OrchestratorAgent supports streaming. During worker execution, events are proxied:

```typescript
for await (const event of orchestrator.stream('Build a REST API')) {
  switch (event.type) {
    case 'text':           // Orchestrator's own text output
    case 'tool_start':     // Orchestrator calling assign_step, etc.
    case 'tool_result':    // Worker completed, result returned
    case 'worker_started': // NEW: worker agent started working
    case 'worker_progress':// NEW: worker iteration progress
    case 'worker_complete':// NEW: worker finished
    case 'artifact_update':// NEW: artifact published/updated
    case 'phase_advance':  // NEW: phase transition (Approach D)
  }
}
```

---

## 11. Usage Examples

### 11.1 Minimal Example (Approach B)

```typescript
import { OrchestratorAgent } from '@everworker/oneringai';

const orchestrator = OrchestratorAgent.create({
  connector: 'anthropic',
  model: 'claude-sonnet-4-6',

  workers: {
    planner: {
      instructions: 'You are a technical planner. Break complex goals into clear, actionable steps.',
      tools: [],
      scope: { readable: [], writable: ['plan'] },
    },
    implementer: {
      instructions: 'You are an expert developer. Write clean, production-ready code.',
      tools: [readFile, writeFile, editFile, bash, glob, grep],
      scope: { readable: ['plan', 'review'], writable: ['code'] },
    },
    reviewer: {
      instructions: 'You are a senior code reviewer. Be thorough but constructive.',
      tools: [readFile, glob, grep],
      scope: { readable: ['plan', 'code'], writable: ['review'] },
    },
  },
});

const result = await orchestrator.run('Build a REST API for user management with Express.js');
console.log(result.output_text);
```

### 11.2 With Phases (Approach D)

```typescript
const orchestrator = OrchestratorAgent.create({
  connector: 'anthropic',
  model: 'claude-opus-4-6',  // Stronger model for orchestration decisions

  workers: {
    planner:      { /* ... */ scope: { readable: [], writable: ['plan'] } },
    implementer:  { /* ... */ scope: { readable: ['plan', 'review'], writable: ['code'] } },
    reviewer:     { /* ... */ scope: { readable: ['plan', 'code'], writable: ['review'] } },
  },

  phases: {
    planning: {
      roles: ['planner'],
      expectedArtifacts: ['plan'],
      maxIterations: 5,
    },
    implementation: {
      roles: ['implementer'],
      expectedArtifacts: ['code'],
      parallel: true,
      maxIterations: 30,
    },
    review: {
      roles: ['reviewer'],
      expectedArtifacts: ['review'],
      canTrigger: ['revision'],
      maxIterations: 10,
    },
    revision: {
      roles: ['implementer'],
      expectedArtifacts: ['code'],
      fallsBackTo: 'review',
      maxIterations: 20,
    },
  },

  artifacts: {
    plan: { schema: PlanArtifactSchema },
    code: { schema: CodeArtifactSchema, maxTokens: 50000 },
    review: { schema: ReviewArtifactSchema },
  },

  orchestration: {
    maxTotalIterations: 200,
    maxParallelWorkers: 3,
    workerTimeout: 300000,
  },
});

// Streaming usage
for await (const event of orchestrator.stream('Build a REST API')) {
  if (event.type === 'phase_advance') {
    console.log(`Phase: ${event.from} → ${event.to}`);
  }
  if (event.type === 'artifact_update') {
    console.log(`Artifact: ${event.key} v${event.version} by ${event.producer}`);
  }
  if (event.type === 'text') {
    process.stdout.write(event.text);
  }
}
```

### 11.3 Tool-Based Delegation (Approach A — Zero Config)

```typescript
import { Agent, createDelegationTools } from '@everworker/oneringai';

// Just add delegation tools to a regular Agent
const agent = Agent.create({
  connector: 'anthropic',
  model: 'claude-sonnet-4-6',
  tools: [
    ...createDelegationTools({
      workers: {
        researcher: { instructions: 'Research using web tools', tools: [webSearch, webScrape] },
        coder: { instructions: 'Write code', tools: [readFile, writeFile, bash] },
      },
    }),
    // Agent's own tools
    readFile, writeFile,
  ],
});

const result = await agent.run('Research best practices for REST APIs, then implement one');
```

### 11.4 Deterministic Pipeline (Approach C)

```typescript
import { Pipeline } from '@everworker/oneringai';

const pipeline = Pipeline.create({
  connector: 'anthropic',

  stages: [
    {
      name: 'plan',
      agent: { model: 'claude-sonnet-4-6', instructions: 'Create a structured plan...' },
      output: { key: 'plan', schema: PlanArtifactSchema },
    },
    {
      name: 'implement',
      agent: { model: 'claude-sonnet-4-6', instructions: 'Implement...', tools: [filesystem, bash] },
      input: ['plan'],
      output: { key: 'code', schema: CodeArtifactSchema },
    },
    {
      name: 'review',
      agent: { model: 'claude-sonnet-4-6', instructions: 'Review...' },
      input: ['plan', 'code'],
      output: { key: 'review', schema: ReviewArtifactSchema },
    },
    {
      name: 'revise',
      agent: { model: 'claude-sonnet-4-6', instructions: 'Fix issues...', tools: [filesystem, bash] },
      input: ['review', 'code'],
      output: { key: 'code' },
      condition: (artifacts) => artifacts.get('review').content.hasBlockingIssues,
      maxRetries: 3,
    },
  ],
});

const result = await pipeline.execute('Build a REST API for user management');
console.log(result.artifacts.get('code'));
```

---

## 12. Implementation Phases

### Phase 1: Foundation (Approach B MVP)

**Goal:** Working orchestrator with workers, artifacts, and plan tracking.

**Components:**
- [ ] `ArtifactRegistry` — in-memory, untyped, with version tracking
- [ ] `WorkerPool` — create/assign/reset workers by role
- [ ] `PlanPlugin` — plan state + artifact summaries in orchestrator context
- [ ] `SharedContextPlugin` — artifact summaries + get/query tools for workers
- [ ] `OrchestratorAgent` — extends Agent, wires everything together
- [ ] Orchestration tools: `assign_step`, `run_parallel`, `revise_plan`
- [ ] Basic tests + example

**Not included:** Schemas, phases, pipeline, streaming events, persistence.

**Estimated scope:** ~8-12 files, ~2000-3000 lines.

### Phase 2: Artifact Maturity

**Goal:** Typed, validated artifacts with layered access.

**Components:**
- [ ] Artifact schemas + validation (JSONSchema)
- [ ] Layered access: summary → query (JSONPath) → full content
- [ ] Artifact change log + version history
- [ ] Worker scope enforcement (read/write permissions)
- [ ] `createDelegationTools()` for Approach A zero-config

### Phase 3: Phase Framework (Approach D)

**Goal:** Optional phase structure for complex workflows.

**Components:**
- [ ] `PhaseManager` — phase definitions, transitions, validation
- [ ] `advance_phase` tool for orchestrator
- [ ] Phase-aware scoping (role X can only act in phase Y)
- [ ] Phase transition events
- [ ] Phase completion detection (all expected artifacts present)

### Phase 4: Pipeline (Approach C)

**Goal:** Deterministic pipeline for repeatable workflows.

**Components:**
- [ ] `Pipeline` class — stage DAG executor
- [ ] Stage conditions and retry logic
- [ ] Parallel fan-out (one worker per plan step)
- [ ] Pipeline events and progress tracking

### Phase 5: Production Hardening

**Goal:** Streaming, persistence, observability.

**Components:**
- [ ] Streaming events (worker_started, artifact_update, phase_advance)
- [ ] Workflow state persistence (checkpoint/resume)
- [ ] Orchestration metrics (per-worker token usage, durations)
- [ ] Error recovery (retry failed workers, escalation)
- [ ] Storage integration via StorageRegistry

---

## 13. Open Questions

### Architecture

1. **Should the orchestrator use a stronger model than workers?**
   - Pro: Better coordination decisions worth the cost
   - Con: Most orchestration is simple routing, not reasoning
   - **Leaning toward:** Yes, recommend Opus for orchestrator, Sonnet for workers — but make it configurable

2. **Should workers know they're in a multi-agent workflow?**
   - Option A: Workers are generic Agents — don't know about orchestration (cleaner)
   - Option B: Workers have workflow-aware instructions (more cooperative)
   - **Leaning toward:** Option B — workers that know they're producing artifacts for others write better outputs

3. **How should the orchestrator's plan be initialized?**
   - Option A: First step is always "assign planner to create plan"
   - Option B: Orchestrator creates plan itself (no planner role needed)
   - Option C: User provides initial plan structure
   - **Leaning toward:** All three supported — planner is optional, orchestrator can plan itself

### Shared Context

4. **Should artifact content be stored in-memory or on filesystem?**
   - In-memory: Fast, simple, lost on process exit
   - Filesystem: Persistent, inspectable, slower
   - Pluggable: StorageRegistry pattern
   - **Leaning toward:** In-memory default with pluggable storage (mirrors session storage pattern)

5. **Should there be a token budget for shared artifacts across all workers?**
   - Global budget prevents runaway artifact growth
   - But artificially limiting artifacts might force truncation
   - **Leaning toward:** Per-artifact limits (configurable), no global budget

6. **How should large code artifacts handle partial updates?**
   - Option A: Full replacement — worker publishes complete artifact each time
   - Option B: Patch model — worker publishes diffs, registry applies
   - **Leaning toward:** Full replacement for v1 (simpler), patch model later

### Orchestration

7. **Should the orchestrator be able to create new roles dynamically?**
   - LLM realizes it needs a "security auditor" role mid-workflow
   - Powerful but hard to bound
   - **Leaning toward:** Not in v1. Pre-defined roles only.

8. **How should human-in-the-loop work?**
   - Orchestrator calls `request_human_input` tool → blocks until response
   - Similar to existing tool permission approval flow
   - **Leaning toward:** Reuse existing approval pattern from ToolPermissionManager

9. **Should the orchestrator support nested delegation (worker delegates to sub-worker)?**
   - One level of orchestration for v1
   - Workers are leaf agents — they execute, not coordinate
   - **Leaning toward:** Not in v1. Workers cannot delegate.

### Integration

10. **How does this relate to the existing AGENT_ORCHESTRATOR_PLAN.md routing system?**
    - Complementary: routing picks which orchestrator to use, orchestrator manages workers
    - Could share components: EventBus, TaskManager concepts overlap
    - **Leaning toward:** Independent for now, share interfaces where natural

---

## Appendix A: File Structure

```
src/core/orchestrator/
├── index.ts                        # Public exports
├── OrchestratorAgent.ts            # Main class (extends Agent)
├── WorkerPool.ts                   # Worker lifecycle management
├── ArtifactRegistry.ts             # Typed artifact storage
├── PhaseManager.ts                 # Phase framework (Approach D)
├── Pipeline.ts                     # Deterministic pipeline (Approach C)
│
├── plugins/
│   ├── PlanPlugin.ts               # Context plugin for orchestrator
│   └── SharedContextPlugin.ts      # Context plugin for workers
│
├── tools/
│   ├── assignStep.ts               # assign_step tool
│   ├── runParallel.ts              # run_parallel tool
│   ├── revisePlan.ts               # revise_plan tool
│   ├── advancePhase.ts             # advance_phase tool
│   ├── requestHumanInput.ts        # request_human_input tool
│   ├── artifactGet.ts              # artifact_get tool (for workers)
│   ├── artifactQuery.ts            # artifact_query tool (for workers)
│   ├── artifactPublish.ts          # artifact_publish tool (for workers)
│   └── delegationTools.ts          # createDelegationTools() (Approach A)
│
├── interfaces/
│   ├── IArtifactRegistry.ts
│   ├── IWorkerPool.ts
│   ├── IPhaseManager.ts
│   └── IPipeline.ts
│
└── types.ts                        # Shared types
```

---

**End of Document**
