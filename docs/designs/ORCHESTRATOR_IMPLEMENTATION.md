# Orchestrator B + Shared Context C — Implementation Design

**Status**: Design — Ready for Review
**Created**: 2026-03-13
**Prereq**: [MULTI_AGENT_ORCHESTRATION.md](MULTI_AGENT_ORCHESTRATION.md) (exploration doc)
**Approach**: Orchestrator B (Agent subclass + WorkerPool) + Shared Context C (Artifact Registry with scoped views)

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Architecture Overview](#2-architecture-overview)
3. [ArtifactRegistry](#3-artifactregistry)
4. [SharedContextPlugin](#4-sharedcontextplugin)
5. [PlanPlugin](#5-planplugin)
6. [WorkerPool](#6-workerpool)
7. [OrchestratorAgent](#7-orchestratoragent)
8. [Orchestration Tools](#8-orchestration-tools)
9. [Worker Tools](#9-worker-tools)
10. [Integration with Agent/Context System](#10-integration-with-agentcontext-system)
11. [Streaming & Events](#11-streaming--events)
12. [Configuration & Factory Methods](#12-configuration--factory-methods)
13. [Error Handling & Edge Cases](#13-error-handling--edge-cases)
14. [Session Persistence](#14-session-persistence)
15. [File Structure & Exports](#15-file-structure--exports)
16. [Implementation Order](#16-implementation-order)

---

## 1. Design Principles

**Seamless integration** — OrchestratorAgent is just an Agent with extra plugins. No new base classes, no parallel hierarchies. Users who know Agent already know 80% of OrchestratorAgent.

**Plugins are the extension mechanism** — PlanPlugin and SharedContextPlugin follow the exact same `IContextPluginNextGen` pattern as WorkingMemory, InContextMemory, etc. They register tools via `getTools()`, inject context via `getContent()`, persist state via `getState()/restoreState()`.

**Artifacts are plain data** — ArtifactRegistry is a simple in-memory store. No framework magic. Workers publish artifacts through tools; orchestrator sees them through PlanPlugin's `getContent()`.

**Workers are regular Agents** — Created via `Agent.create()` with a SharedContextPlugin registered. No special worker class. Any Agent with a SharedContextPlugin is a worker.

**Configuration over convention** — Everything has sensible defaults but is overridable. You can use OrchestratorAgent with zero phase config (pure LLM-driven) or with strict phases.

---

## 2. Architecture Overview

### Component Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                         OrchestratorAgent                              │
│                      (extends Agent — IS-A Agent)                      │
│                                                                        │
│  AgentContextNextGen (orchestrator's own, private)                     │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  System Prompt: "You are an orchestrator..."                     │  │
│  │                                                                  │  │
│  │  Plugins:                                                        │  │
│  │  ┌────────────┐  ┌────────────────┐  ┌──────────────────────┐   │  │
│  │  │ PlanPlugin │  │ WorkingMemory  │  │ InContextMemory etc. │   │  │
│  │  │ (NEW)      │  │ (existing)     │  │ (existing, optional) │   │  │
│  │  └────────────┘  └────────────────┘  └──────────────────────┘   │  │
│  │                                                                  │  │
│  │  Tools (via ToolManager):                                        │  │
│  │  ┌────────────────────────────────────────────────────────────┐  │  │
│  │  │ assign_task | run_parallel | update_plan | complete_phase  │  │  │
│  │  │ (from PlanPlugin)                                          │  │  │
│  │  │ + memory_store, memory_retrieve, ... (from WorkingMemory)  │  │  │
│  │  │ + any user-added tools                                     │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────┐    ┌─────────────────────────────────────────┐   │
│  │   WorkerPool     │    │         ArtifactRegistry                │   │
│  │                  │    │  (shared across orchestrator + workers)  │   │
│  │  "planner" ──────│───▶│  ┌──────┐ ┌──────┐ ┌────────┐          │   │
│  │  "implementer" ──│───▶│  │ plan │ │ code │ │ review │          │   │
│  │  "reviewer" ─────│───▶│  │  v1  │ │  v2  │ │  v1    │          │   │
│  │                  │    │  └──────┘ └──────┘ └────────┘          │   │
│  └──────────────────┘    └─────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘

Worker (e.g., "implementer") — regular Agent with SharedContextPlugin:
┌──────────────────────────────────────────────────────────────────┐
│  Agent (created by WorkerPool via Agent.create())               │
│                                                                  │
│  AgentContextNextGen (worker's own, private)                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  System Prompt: "You are an expert implementer..."        │   │
│  │                                                           │   │
│  │  Plugins:                                                 │   │
│  │  ┌──────────────────┐  ┌────────────────┐                │   │
│  │  │ SharedContext     │  │ WorkingMemory  │                │   │
│  │  │ Plugin (NEW)     │  │ (private)      │                │   │
│  │  │ - sees: plan,    │  │                │                │   │
│  │  │   review         │  │                │                │   │
│  │  │ - writes: code   │  │                │                │   │
│  │  └──────────────────┘  └────────────────┘                │   │
│  │                                                           │   │
│  │  Tools:                                                   │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │ artifact_get | artifact_query | artifact_publish   │  │   │
│  │  │ (from SharedContextPlugin)                         │  │   │
│  │  │ + read_file, write_file, bash, ... (role tools)    │  │   │
│  │  │ + memory_store, memory_retrieve (private memory)   │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
1. User calls: orchestrator.run("Build a REST API")
2. Orchestrator LLM sees: system prompt + PlanPlugin content (empty plan + no artifacts)
3. Orchestrator LLM calls: assign_task("planner", "Create implementation plan")
4. OrchestratorAgent.assignTask():
   a. WorkerPool creates Agent for "planner" role
   b. Agent gets SharedContextPlugin(registry, scope={readable:[], writable:['plan']})
   c. Worker runs: agent.run("Create implementation plan")
   d. Worker calls: artifact_publish("plan", {steps:[...]}, "5-step REST API plan")
   e. ArtifactRegistry stores plan v1
   f. Worker finishes → WorkerResult returned to orchestrator as tool result
5. Orchestrator LLM sees: PlanPlugin content now shows plan artifact
6. Orchestrator LLM calls: assign_task("implementer", "Implement step 1: user endpoints")
7. ... cycle continues until orchestrator is satisfied
8. Orchestrator produces final text response
```

---

## 3. ArtifactRegistry

The central store for all work products shared between agents. Pure data structure — no LLM, no plugins, no tools. Other components build on top of it.

### Design

```typescript
// src/core/orchestrator/ArtifactRegistry.ts

export type ArtifactType = 'plan' | 'code' | 'review' | 'data' | 'text';

export interface Artifact<T = unknown> {
  readonly key: string;
  readonly type: ArtifactType;
  summary: string;
  content: T;
  producer: string;           // Role name that created/last updated this
  version: number;
  tokens: number;             // Estimated token count of content
  createdAt: Date;
  updatedAt: Date;
}

export interface ArtifactSummary {
  key: string;
  type: ArtifactType;
  summary: string;
  producer: string;
  version: number;
  tokens: number;
  updatedAt: Date;
}

export interface ArtifactUpdate {
  key: string;
  version: number;
  previousVersion: number;
  producer: string;
  changeSummary: string;
  timestamp: Date;
}

export class ArtifactRegistry {
  private _artifacts: Map<string, Artifact> = new Map();
  private _history: Map<string, Artifact[]> = new Map();    // Previous versions
  private _changeLog: ArtifactUpdate[] = [];
  private _listeners: Set<(update: ArtifactUpdate) => void> = new Set();
  private _estimator: ITokenEstimator;

  constructor(estimator?: ITokenEstimator) {
    this._estimator = estimator ?? simpleTokenEstimator;
  }

  // === Publishing ===

  publish(key: string, input: {
    type: ArtifactType;
    content: unknown;
    summary: string;
    producer: string;
  }): Artifact {
    const existing = this._artifacts.get(key);

    if (existing) {
      // Update: archive current version, increment
      this._archiveVersion(key, existing);
      const updated: Artifact = {
        ...existing,
        content: input.content,
        summary: input.summary,
        producer: input.producer,
        version: existing.version + 1,
        tokens: this._estimateTokens(input.content),
        updatedAt: new Date(),
      };
      this._artifacts.set(key, updated);
      this._recordChange(key, updated.version, existing.version, input.producer,
        `Updated by ${input.producer}`);
      return updated;
    }

    // New artifact
    const artifact: Artifact = {
      key,
      type: input.type,
      content: input.content,
      summary: input.summary,
      producer: input.producer,
      version: 1,
      tokens: this._estimateTokens(input.content),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this._artifacts.set(key, artifact);
    this._recordChange(key, 1, 0, input.producer, `Created by ${input.producer}`);
    return artifact;
  }

  // === Reading ===

  get(key: string): Artifact | null {
    return this._artifacts.get(key) ?? null;
  }

  getSummary(key: string): ArtifactSummary | null {
    const a = this._artifacts.get(key);
    if (!a) return null;
    return { key: a.key, type: a.type, summary: a.summary,
             producer: a.producer, version: a.version,
             tokens: a.tokens, updatedAt: a.updatedAt };
  }

  /**
   * Query into artifact content using dot-path notation.
   * Supports: "steps", "steps[0]", "steps[0].description", "files"
   * Returns the value at that path, or undefined if not found.
   */
  query(key: string, path: string): unknown {
    const artifact = this._artifacts.get(key);
    if (!artifact) return undefined;
    return this._resolvePath(artifact.content, path);
  }

  list(): ArtifactSummary[] {
    return Array.from(this._artifacts.values()).map(a => ({
      key: a.key, type: a.type, summary: a.summary,
      producer: a.producer, version: a.version,
      tokens: a.tokens, updatedAt: a.updatedAt,
    }));
  }

  // === History ===

  getVersion(key: string, version: number): Artifact | null {
    const current = this._artifacts.get(key);
    if (current?.version === version) return current;
    const history = this._history.get(key) ?? [];
    return history.find(a => a.version === version) ?? null;
  }

  getChangeLog(since?: Date): ArtifactUpdate[] {
    if (!since) return [...this._changeLog];
    return this._changeLog.filter(u => u.timestamp >= since);
  }

  // === Events ===

  onChange(handler: (update: ArtifactUpdate) => void): () => void {
    this._listeners.add(handler);
    return () => this._listeners.delete(handler);
  }

  // === Lifecycle ===

  clear(): void { this._artifacts.clear(); this._history.clear(); this._changeLog = []; }
  delete(key: string): void { this._artifacts.delete(key); this._history.delete(key); }
  get size(): number { return this._artifacts.size; }

  // === Serialization (for session persistence) ===

  getState(): SerializedArtifactRegistryState {
    return {
      artifacts: Object.fromEntries(
        Array.from(this._artifacts.entries()).map(([k, v]) => [k, { ...v }])
      ),
      changeLog: [...this._changeLog],
    };
  }

  restoreState(state: SerializedArtifactRegistryState): void {
    this._artifacts.clear();
    for (const [key, artifact] of Object.entries(state.artifacts)) {
      this._artifacts.set(key, {
        ...artifact,
        createdAt: new Date(artifact.createdAt),
        updatedAt: new Date(artifact.updatedAt),
      });
    }
    this._changeLog = (state.changeLog ?? []).map(u => ({
      ...u, timestamp: new Date(u.timestamp),
    }));
  }

  // === Private ===

  private _archiveVersion(key: string, artifact: Artifact): void {
    const history = this._history.get(key) ?? [];
    history.push({ ...artifact });
    this._history.set(key, history);
  }

  private _recordChange(
    key: string, version: number, prev: number,
    producer: string, changeSummary: string
  ): void {
    const update: ArtifactUpdate = {
      key, version, previousVersion: prev, producer, changeSummary,
      timestamp: new Date(),
    };
    this._changeLog.push(update);
    for (const listener of this._listeners) {
      try { listener(update); } catch { /* ignore listener errors */ }
    }
  }

  private _estimateTokens(content: unknown): number {
    if (typeof content === 'string') return this._estimator.estimateTokens(content);
    return this._estimator.estimateDataTokens(content);
  }

  private _resolvePath(obj: unknown, path: string): unknown {
    // Simple dot/bracket path resolver: "steps[0].description"
    const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current: unknown = obj;
    for (const seg of segments) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[seg];
    }
    return current;
  }
}

export interface SerializedArtifactRegistryState {
  artifacts: Record<string, Artifact>;
  changeLog: ArtifactUpdate[];
}
```

### Key Design Decisions

1. **No schemas in v1** — Content is `unknown`. Worker LLMs produce JSON naturally; validation can come later.
2. **Version history kept in-memory** — Only current version is serialized for sessions. Old versions are for in-session audit trail.
3. **Path queries** — Simple dot-notation resolver. Workers can explore artifact structure without loading full content. No dependency on external JSONPath libraries.
4. **Token estimation** — Uses the same `simpleTokenEstimator` from context-nextgen. Consistent with how all other token counting works.
5. **Change listeners** — Simple callback set. PlanPlugin subscribes to get notified when artifacts change (to invalidate its token cache).

---

## 4. SharedContextPlugin

A `IContextPluginNextGen` plugin registered on **worker** agents. Provides scoped read/write access to the ArtifactRegistry.

### Design

```typescript
// src/core/orchestrator/plugins/SharedContextPlugin.ts

export interface WorkerScope {
  role: string;
  readable: string[];    // Artifact keys this worker can read
  writable: string[];    // Artifact keys this worker can write/create
}

export interface SharedContextPluginConfig {
  registry: ArtifactRegistry;
  scope: WorkerScope;
}

export class SharedContextPlugin extends BasePluginNextGen {
  readonly name = 'shared_context';

  private _registry: ArtifactRegistry;
  private _scope: WorkerScope;

  constructor(config: SharedContextPluginConfig) {
    super();
    this._registry = config.registry;
    this._scope = config.scope;
  }

  // === IContextPluginNextGen ===

  getInstructions(): string | null {
    const readable = this._scope.readable;
    const writable = this._scope.writable;

    if (readable.length === 0 && writable.length === 0) return null;

    const lines: string[] = [
      '## Shared Artifacts',
      'You are part of a multi-agent workflow. Shared artifacts are listed below.',
    ];

    if (readable.length > 0) {
      lines.push(`You can READ: ${readable.join(', ')}.`);
      lines.push('Use `artifact_get(key)` to load full content or `artifact_query(key, path)` to explore structure.');
    }

    if (writable.length > 0) {
      lines.push(`You can WRITE: ${writable.join(', ')}.`);
      lines.push('Use `artifact_publish(key, type, content, summary)` to publish your work.');
      lines.push('Always include a clear summary. Other agents will see it.');
    }

    return lines.join('\n');
  }

  async getContent(): Promise<string | null> {
    // Show summaries of all readable artifacts that exist
    const allArtifacts = this._registry.list();
    const visible = allArtifacts.filter(a => this._scope.readable.includes(a.key));

    if (visible.length === 0) {
      this.updateTokenCache(0);
      return null;
    }

    const lines = ['## Available Artifacts'];
    for (const a of visible) {
      lines.push(`- **${a.key}** (by ${a.producer}, v${a.version}, ~${a.tokens} tokens): ${a.summary}`);
    }

    const content = lines.join('\n');
    this.updateTokenCache(this.estimator.estimateTokens(content));
    return content;
  }

  getContents(): { scope: WorkerScope; artifacts: ArtifactSummary[] } {
    return {
      scope: this._scope,
      artifacts: this._registry.list().filter(a => this._scope.readable.includes(a.key)),
    };
  }

  isCompactable(): boolean { return false; }
  // Artifact summaries are small — no compaction needed.

  getTools(): ToolFunction[] {
    const tools: ToolFunction[] = [];

    // Always provide get + query for readable artifacts
    if (this._scope.readable.length > 0) {
      tools.push(this._createArtifactGetTool());
      tools.push(this._createArtifactQueryTool());
    }

    // Provide publish for writable artifacts
    if (this._scope.writable.length > 0) {
      tools.push(this._createArtifactPublishTool());
    }

    return tools;
  }

  getState(): { scope: WorkerScope } {
    return { scope: this._scope };
  }

  restoreState(state: unknown): void {
    if (state && typeof state === 'object' && 'scope' in state) {
      this._scope = (state as { scope: WorkerScope }).scope;
    }
  }

  // === Tool Factories ===

  private _createArtifactGetTool(): ToolFunction {
    return {
      definition: {
        type: 'function',
        function: {
          name: 'artifact_get',
          description: 'Load the full content of a shared artifact. Use this when you need the complete data.',
          parameters: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: `Artifact key. Available: ${this._scope.readable.join(', ')}`,
              },
            },
            required: ['key'],
          },
        },
      },
      execute: async (args: Record<string, unknown>) => {
        const key = args.key as string;
        if (!this._scope.readable.includes(key)) {
          return { error: `No read access to artifact '${key}'` };
        }
        const artifact = this._registry.get(key);
        if (!artifact) return { error: `Artifact '${key}' not found` };
        return {
          key: artifact.key,
          type: artifact.type,
          version: artifact.version,
          producer: artifact.producer,
          summary: artifact.summary,
          content: artifact.content,
        };
      },
      permission: { scope: 'always', riskLevel: 'low' },
      describeCall: (args) => `get artifact: ${args.key}`,
    };
  }

  private _createArtifactQueryTool(): ToolFunction {
    return {
      definition: {
        type: 'function',
        function: {
          name: 'artifact_query',
          description: 'Query into an artifact\'s structure without loading all content. Use dot-path notation: "steps", "steps[0].description", "files[2].content".',
          parameters: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: `Artifact key. Available: ${this._scope.readable.join(', ')}`,
              },
              path: {
                type: 'string',
                description: 'Dot-path into the artifact content.',
              },
            },
            required: ['key', 'path'],
          },
        },
      },
      execute: async (args: Record<string, unknown>) => {
        const key = args.key as string;
        const path = args.path as string;
        if (!this._scope.readable.includes(key)) {
          return { error: `No read access to artifact '${key}'` };
        }
        const artifact = this._registry.get(key);
        if (!artifact) return { error: `Artifact '${key}' not found` };
        const result = this._registry.query(key, path);
        if (result === undefined) return { error: `Path '${path}' not found in '${key}'` };
        return { key, path, value: result };
      },
      permission: { scope: 'always', riskLevel: 'low' },
      describeCall: (args) => `query artifact: ${args.key}.${args.path}`,
    };
  }

  private _createArtifactPublishTool(): ToolFunction {
    return {
      definition: {
        type: 'function',
        function: {
          name: 'artifact_publish',
          description: 'Publish or update a shared artifact with your work product. Include a clear summary — other agents will see it. If the artifact already exists, it will be versioned.',
          parameters: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: `Artifact key to publish. You can write: ${this._scope.writable.join(', ')}`,
              },
              type: {
                type: 'string',
                enum: ['plan', 'code', 'review', 'data', 'text'],
                description: 'Type of artifact.',
              },
              content: {
                description: 'The artifact content. Can be any JSON value — object, array, string, etc.',
              },
              summary: {
                type: 'string',
                description: 'Short summary (1-2 sentences) describing what this artifact contains. Other agents see this summary without loading full content.',
              },
            },
            required: ['key', 'type', 'content', 'summary'],
          },
        },
      },
      execute: async (args: Record<string, unknown>) => {
        const key = args.key as string;
        if (!this._scope.writable.includes(key)) {
          return { error: `No write access to artifact '${key}'` };
        }
        const artifact = this._registry.publish(key, {
          type: args.type as ArtifactType,
          content: args.content,
          summary: args.summary as string,
          producer: this._scope.role,
        });
        return {
          success: true,
          key: artifact.key,
          version: artifact.version,
          tokens: artifact.tokens,
        };
      },
      permission: { scope: 'always', riskLevel: 'low' },
      describeCall: (args) => `publish artifact: ${args.key}`,
    };
  }
}
```

### Key Design Decisions

1. **Plugin follows exact BasePluginNextGen pattern** — `getInstructions()` for static guide, `getContent()` for dynamic artifact index, `getTools()` for auto-registered tools, `getState()/restoreState()` for persistence.

2. **Scope is static per assignment** — Set when the worker is created/assigned. Not dynamically changeable. This prevents scope creep and makes access patterns auditable.

3. **Tools are scope-aware** — `artifact_get`/`artifact_query` descriptions list readable keys. `artifact_publish` description lists writable keys. LLM sees exactly what's available.

4. **Permission is 'always' / 'low'** — Artifact tools don't need approval. They're scoped by design and operate on in-memory data.

5. **No compaction** — Artifact summaries in `getContent()` are small (one line per artifact). Not worth compacting.

6. **`artifact_query` path resolver** uses the same `_resolvePath` logic from ArtifactRegistry. Workers can drill into structured artifacts cheaply.

---

## 5. PlanPlugin

A `IContextPluginNextGen` plugin registered on the **orchestrator** agent. Shows plan state, artifact index, worker status, and recent changes in the orchestrator's context. Also provides the orchestration tools.

### Design

```typescript
// src/core/orchestrator/plugins/PlanPlugin.ts

export interface PlanStep {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';
  assignedRole?: string;
  dependencies: string[];
  result?: string;            // Brief result summary after completion
}

export interface PlanState {
  goal: string;
  steps: PlanStep[];
  currentPhase?: string;      // Optional phase tracking
}

export interface PlanPluginConfig {
  registry: ArtifactRegistry;
  workerPool: WorkerPool;
  maxPlanSteps?: number;      // Default: 30
}

export class PlanPlugin extends BasePluginNextGen {
  readonly name = 'orchestrator_plan';

  private _registry: ArtifactRegistry;
  private _workerPool: WorkerPool;
  private _plan: PlanState;
  private _maxPlanSteps: number;
  private _recentChanges: ArtifactUpdate[] = [];
  private _unsubscribe: (() => void) | null = null;

  constructor(config: PlanPluginConfig) {
    super();
    this._registry = config.registry;
    this._workerPool = config.workerPool;
    this._plan = { goal: '', steps: [] };
    this._maxPlanSteps = config.maxPlanSteps ?? 30;

    // Subscribe to artifact changes for real-time updates
    this._unsubscribe = this._registry.onChange((update) => {
      this._recentChanges.push(update);
      // Keep last 10 changes
      if (this._recentChanges.length > 10) {
        this._recentChanges = this._recentChanges.slice(-10);
      }
      this.invalidateTokenCache();
    });
  }

  // === IContextPluginNextGen ===

  getInstructions(): string | null {
    return `## Multi-Agent Orchestration

You are an orchestrator managing worker agents toward a goal.

**Your tools:**
- \`assign_task(role, prompt)\` — Assign a task to a worker agent. The worker runs autonomously and returns a result.
- \`run_parallel(assignments)\` — Run multiple tasks in parallel. Use when tasks are independent.
- \`update_plan(goal?, steps?)\` — Create or update the execution plan. Call this first to establish your strategy.

**Workflow:**
1. Analyze the user's goal
2. Use \`update_plan\` to create a structured plan with steps
3. Use \`assign_task\` to delegate steps to workers (planner, implementer, reviewer, etc.)
4. Workers publish artifacts (plan, code, review) that you and other workers can see
5. Monitor progress, adjust plan as needed, iterate until the goal is achieved
6. When satisfied, provide a final response to the user

**Available worker roles are listed in the plan section below.**
**Current artifacts and their summaries are shown below — workers can load full content.**`;
  }

  async getContent(): Promise<string | null> {
    const sections: string[] = [];

    // 1. Plan state
    sections.push(this._renderPlan());

    // 2. Available worker roles
    sections.push(this._renderWorkerRoles());

    // 3. Artifact index
    const artifactSection = this._renderArtifacts();
    if (artifactSection) sections.push(artifactSection);

    // 4. Recent changes
    const changesSection = this._renderRecentChanges();
    if (changesSection) sections.push(changesSection);

    // 5. Active workers
    const workersSection = this._renderActiveWorkers();
    if (workersSection) sections.push(workersSection);

    const content = sections.join('\n\n');
    this.updateTokenCache(this.estimator.estimateTokens(content));
    return content;
  }

  getContents(): { plan: PlanState; artifacts: ArtifactSummary[]; changes: ArtifactUpdate[] } {
    return {
      plan: this._plan,
      artifacts: this._registry.list(),
      changes: this._recentChanges,
    };
  }

  isCompactable(): boolean { return true; }

  async compact(targetTokensToFree: number): Promise<number> {
    // Compact by trimming change log and completed step details
    const beforeTokens = this.getTokenSize();
    this._recentChanges = this._recentChanges.slice(-3);

    // Trim result text from completed steps
    for (const step of this._plan.steps) {
      if (step.status === 'done' && step.result && step.result.length > 100) {
        step.result = step.result.substring(0, 100) + '...';
      }
    }

    this.invalidateTokenCache();
    await this.recalculateTokenCache();
    return Math.max(0, beforeTokens - this.getTokenSize());
  }

  getTools(): ToolFunction[] {
    return [
      this._createAssignTaskTool(),
      this._createRunParallelTool(),
      this._createUpdatePlanTool(),
    ];
  }

  destroy(): void {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }

  getState(): { plan: PlanState; recentChanges: ArtifactUpdate[] } {
    return {
      plan: structuredClone(this._plan),
      recentChanges: [...this._recentChanges],
    };
  }

  restoreState(state: unknown): void {
    if (state && typeof state === 'object') {
      const s = state as { plan?: PlanState; recentChanges?: ArtifactUpdate[] };
      if (s.plan) this._plan = s.plan;
      if (s.recentChanges) this._recentChanges = s.recentChanges;
    }
  }

  // === Public API (for OrchestratorAgent to call directly) ===

  get plan(): PlanState { return this._plan; }

  updatePlan(updates: { goal?: string; steps?: PlanStep[] }): void {
    if (updates.goal) this._plan.goal = updates.goal;
    if (updates.steps) this._plan.steps = updates.steps;
    this.invalidateTokenCache();
  }

  updateStepStatus(stepId: string, status: PlanStep['status'], result?: string): void {
    const step = this._plan.steps.find(s => s.id === stepId);
    if (step) {
      step.status = status;
      if (result) step.result = result;
      this.invalidateTokenCache();
    }
  }

  // === Renderers ===

  private _renderPlan(): string {
    if (!this._plan.goal && this._plan.steps.length === 0) {
      return '## Plan\nNo plan created yet. Use `update_plan` to create one.';
    }

    const lines = ['## Plan'];
    if (this._plan.goal) lines.push(`**Goal:** ${this._plan.goal}`);

    if (this._plan.steps.length > 0) {
      const done = this._plan.steps.filter(s => s.status === 'done').length;
      lines.push(`**Progress:** ${done}/${this._plan.steps.length} steps completed\n`);
      lines.push('| # | Step | Status | Assigned | Result |');
      lines.push('|---|------|--------|----------|--------|');
      for (const step of this._plan.steps) {
        const status = this._statusIcon(step.status);
        const result = step.result ? step.result.substring(0, 60) : '';
        lines.push(`| ${step.id} | ${step.description} | ${status} | ${step.assignedRole ?? '-'} | ${result} |`);
      }
    }

    return lines.join('\n');
  }

  private _renderWorkerRoles(): string {
    const roles = this._workerPool.listRoles();
    if (roles.length === 0) return '## Workers\nNo worker roles configured.';

    const lines = ['## Available Workers'];
    for (const role of roles) {
      const config = this._workerPool.getRoleConfig(role);
      if (!config) continue;
      const scopeDesc = [
        config.scope.readable.length > 0 ? `reads: ${config.scope.readable.join(',')}` : null,
        config.scope.writable.length > 0 ? `writes: ${config.scope.writable.join(',')}` : null,
      ].filter(Boolean).join('; ');
      lines.push(`- **${role}**: ${scopeDesc || 'no artifact access'}`);
    }
    return lines.join('\n');
  }

  private _renderArtifacts(): string | null {
    const artifacts = this._registry.list();
    if (artifacts.length === 0) return null;

    const lines = ['## Artifacts'];
    for (const a of artifacts) {
      lines.push(`- **${a.key}** (v${a.version}, by ${a.producer}, ~${a.tokens} tokens): ${a.summary}`);
    }
    return lines.join('\n');
  }

  private _renderRecentChanges(): string | null {
    if (this._recentChanges.length === 0) return null;

    const lines = ['## Recent Changes'];
    for (const change of this._recentChanges.slice(-5)) {
      const time = change.timestamp.toLocaleTimeString('en-US', { hour12: false });
      lines.push(`- [${time}] ${change.key} v${change.previousVersion}→v${change.version} (${change.producer}): ${change.changeSummary}`);
    }
    return lines.join('\n');
  }

  private _renderActiveWorkers(): string | null {
    const active = this._workerPool.getActiveWorkers();
    if (active.length === 0) return null;

    const lines = ['## Active Workers'];
    for (const w of active) {
      lines.push(`- **${w.role}**: ${w.status}${w.currentTask ? ` — "${w.currentTask}"` : ''}`);
    }
    return lines.join('\n');
  }

  private _statusIcon(status: PlanStep['status']): string {
    switch (status) {
      case 'pending': return 'pending';
      case 'in_progress': return 'IN PROGRESS';
      case 'done': return 'DONE';
      case 'failed': return 'FAILED';
      case 'skipped': return 'skipped';
    }
  }

  // === Tool Factories ===
  // (See Section 8: Orchestration Tools for full tool definitions)

  private _createAssignTaskTool(): ToolFunction { /* ... */ }
  private _createRunParallelTool(): ToolFunction { /* ... */ }
  private _createUpdatePlanTool(): ToolFunction { /* ... */ }
}
```

### Key Design Decisions

1. **PlanPlugin owns the plan AND the orchestration tools** — This is the natural home. The plan state, artifact index, and tools that modify them are all in one plugin. This follows the pattern set by WorkingMemoryPlugin (owns memory tools) and InContextMemoryPlugin (owns context tools).

2. **PlanPlugin holds a reference to WorkerPool** — It needs this to render worker status and to implement `assign_task` tool execution. This is similar to how ToolCatalogPlugin holds a reference to ToolManager.

3. **Content includes 5 sections** — Plan state, worker roles, artifact index, recent changes, active workers. This gives the orchestrator LLM everything it needs in one view.

4. **Compactable** — Can trim change log and step result details when context gets tight.

5. **Change listener on ArtifactRegistry** — PlanPlugin subscribes to artifact changes. When a worker publishes an artifact, PlanPlugin's token cache invalidates, so the next `prepare()` picks up the new artifact summary.

---

## 6. WorkerPool

Manages creating and running worker Agents by role. Thin layer over `Agent.create()`.

### Design

```typescript
// src/core/orchestrator/WorkerPool.ts

export interface WorkerRoleConfig {
  /** Override orchestrator's connector (default: inherit) */
  connector?: string | Connector;
  /** Override model (default: inherit from orchestrator) */
  model?: string;
  /** Role-specific system prompt */
  instructions: string;
  /** Tools available to this role (default: none) */
  tools?: ToolFunction[];
  /** Context features for worker (default: { workingMemory: false }) */
  features?: ContextFeatures;
  /** Artifact access scope */
  scope: WorkerScope;
  /** Max iterations per assignment (default: 30) */
  maxIterations?: number;
  /** Temperature (default: 0.7) */
  temperature?: number;
  /** Whether to reuse the agent instance across assignments (default: false) */
  reuse?: boolean;
}

export interface WorkerTask {
  /** Task description/prompt for the worker */
  prompt: string;
  /** Optional: plan step being worked on */
  stepId?: string;
  /** Optional: override role config for this assignment */
  overrides?: Partial<Pick<WorkerRoleConfig, 'maxIterations' | 'temperature'>>;
}

export interface WorkerResult {
  /** Worker's final text output */
  output: string;
  /** Whether the task completed successfully */
  success: boolean;
  /** Artifacts published during this task */
  publishedArtifacts: ArtifactSummary[];
  /** Execution metrics */
  metrics: {
    iterations: number;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
  };
  /** Error message if !success */
  error?: string;
}

export interface WorkerAssignment {
  role: string;
  task: WorkerTask;
}

export interface ActiveWorkerInfo {
  role: string;
  status: 'idle' | 'working';
  currentTask?: string;
}

export class WorkerPool implements IDisposable {
  private _roles: Map<string, WorkerRoleConfig> = new Map();
  private _workers: Map<string, Agent> = new Map();        // Reusable worker instances
  private _activeWorkers: Map<string, ActiveWorkerInfo> = new Map();
  private _registry: ArtifactRegistry;
  private _defaultConnector: string | Connector;
  private _defaultModel: string;
  private _isDestroyed = false;

  constructor(config: {
    registry: ArtifactRegistry;
    defaultConnector: string | Connector;
    defaultModel: string;
    roles?: Record<string, WorkerRoleConfig>;
  }) {
    this._registry = config.registry;
    this._defaultConnector = config.defaultConnector;
    this._defaultModel = config.defaultModel;
    if (config.roles) {
      for (const [name, roleConfig] of Object.entries(config.roles)) {
        this._roles.set(name, roleConfig);
      }
    }
  }

  // === Role Management ===

  registerRole(name: string, config: WorkerRoleConfig): void {
    this._roles.set(name, config);
  }

  getRoleConfig(name: string): WorkerRoleConfig | undefined {
    return this._roles.get(name);
  }

  listRoles(): string[] {
    return Array.from(this._roles.keys());
  }

  // === Assignment ===

  async assign(role: string, task: WorkerTask): Promise<WorkerResult> {
    const roleConfig = this._roles.get(role);
    if (!roleConfig) {
      return { output: '', success: false, publishedArtifacts: [],
        metrics: { iterations: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 },
        error: `Unknown worker role: '${role}'` };
    }

    // Track active worker
    const workerInfo: ActiveWorkerInfo = { role, status: 'working', currentTask: task.prompt.substring(0, 100) };
    this._activeWorkers.set(role, workerInfo);

    try {
      // Track which artifacts exist before assignment
      const beforeArtifacts = new Set(this._registry.list().map(a => `${a.key}:${a.version}`));

      const agent = this._getOrCreateWorker(role, roleConfig, task.overrides);
      const startTime = Date.now();

      const response = await agent.run(task.prompt, {
        maxIterations: task.overrides?.maxIterations ?? roleConfig.maxIterations ?? 30,
      });

      // Determine which artifacts were published/updated
      const afterArtifacts = this._registry.list();
      const publishedArtifacts = afterArtifacts.filter(
        a => !beforeArtifacts.has(`${a.key}:${a.version}`)
      );

      return {
        output: response.output_text ?? '',
        success: response.status === 'completed',
        publishedArtifacts,
        metrics: {
          iterations: 0, // TODO: get from execution context
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          durationMs: Date.now() - startTime,
        },
      };
    } catch (error) {
      return {
        output: '', success: false, publishedArtifacts: [],
        metrics: { iterations: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 },
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // Update active worker status
      workerInfo.status = 'idle';
      workerInfo.currentTask = undefined;
    }
  }

  async assignParallel(assignments: WorkerAssignment[]): Promise<WorkerResult[]> {
    // Run all assignments concurrently
    // Note: parallel workers get separate Agent instances even if same role
    return Promise.all(assignments.map(a => this.assign(a.role, a.task)));
  }

  // === Worker Instance Management ===

  private _getOrCreateWorker(
    role: string,
    roleConfig: WorkerRoleConfig,
    overrides?: Partial<Pick<WorkerRoleConfig, 'maxIterations' | 'temperature'>>
  ): Agent {
    // If reuse is enabled and we have an existing worker, reset and reuse
    if (roleConfig.reuse) {
      const existing = this._workers.get(role);
      if (existing && !existing.isDestroyed) {
        // Clear conversation but keep plugins/tools
        existing.context.clearConversation('New task assignment');
        return existing;
      }
    }

    // Create new worker agent
    const agent = Agent.create({
      connector: roleConfig.connector ?? this._defaultConnector,
      model: roleConfig.model ?? this._defaultModel,
      name: `worker-${role}`,
      instructions: roleConfig.instructions,
      tools: roleConfig.tools ?? [],
      temperature: overrides?.temperature ?? roleConfig.temperature,
      maxIterations: overrides?.maxIterations ?? roleConfig.maxIterations ?? 30,
      context: {
        features: roleConfig.features ?? { workingMemory: false },
      },
    });

    // Register SharedContextPlugin on the worker
    const sharedPlugin = new SharedContextPlugin({
      registry: this._registry,
      scope: roleConfig.scope,
    });
    agent.context.registerPlugin(sharedPlugin);

    // If reuse is enabled, cache the worker
    if (roleConfig.reuse) {
      // Destroy previous if exists
      const prev = this._workers.get(role);
      if (prev && !prev.isDestroyed) prev.destroy();
      this._workers.set(role, agent);
    }

    return agent;
  }

  // === Query ===

  getActiveWorkers(): ActiveWorkerInfo[] {
    return Array.from(this._activeWorkers.values());
  }

  getWorker(role: string): Agent | undefined {
    return this._workers.get(role);
  }

  // === Lifecycle ===

  get isDestroyed(): boolean { return this._isDestroyed; }

  destroy(): void {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    for (const agent of this._workers.values()) {
      if (!agent.isDestroyed) agent.destroy();
    }
    this._workers.clear();
    this._activeWorkers.clear();
  }
}
```

### Key Design Decisions

1. **Workers are regular Agents** — Created via `Agent.create()`. No special worker class. SharedContextPlugin is registered after creation via `agent.context.registerPlugin()`. This is the exact same pattern a user would follow manually.

2. **Default: no reuse** — Each `assign()` call creates a fresh Agent. Clean context, no cross-task pollution. Workers that should accumulate context (e.g., an implementer building incrementally) opt in via `reuse: true`.

3. **Parallel creates separate instances** — Even for the same role. Two parallel implementers each get their own Agent with their own context. They share the ArtifactRegistry (reads are safe; writes to different keys are safe).

4. **WorkerPool doesn't own the agentic loop** — It calls `agent.run()` and returns the result. The existing Agent loop handles all iteration, tool execution, compaction, etc. WorkerPool is purely lifecycle management.

5. **Default features: `{ workingMemory: false }`** — Workers are stateless by default. They have SharedContextPlugin for artifact access but no working memory. Workers that need scratch space opt in via `features: { workingMemory: true }`.

6. **Connector/model inheritance** — Workers default to the orchestrator's connector and model. Override per-role for cost optimization (e.g., cheaper model for simple tasks).

---

## 7. OrchestratorAgent

Extends `Agent`. Creates ArtifactRegistry, WorkerPool, and PlanPlugin. Wires everything together.

### Design

```typescript
// src/core/orchestrator/OrchestratorAgent.ts

export interface OrchestratorAgentConfig extends AgentConfig {
  /** Worker role definitions */
  workers: Record<string, WorkerRoleConfig>;

  /** Orchestration behavior */
  orchestration?: {
    /** Max total iterations across all workers (default: 200) */
    maxTotalWorkerIterations?: number;
    /** Max concurrent parallel workers (default: 5) */
    maxParallelWorkers?: number;
    /** Timeout per worker assignment in ms (default: 300000 = 5min) */
    workerTimeout?: number;
    /** Max plan steps (default: 30) */
    maxPlanSteps?: number;
  };
}

export class OrchestratorAgent extends Agent {
  private _artifactRegistry: ArtifactRegistry;
  private _workerPool: WorkerPool;
  private _planPlugin: PlanPlugin;
  private _orchestrationConfig: Required<NonNullable<OrchestratorAgentConfig['orchestration']>>;

  // Total worker iterations tracker (across all assignments)
  private _totalWorkerIterations = 0;

  /**
   * Factory method — the primary way to create an OrchestratorAgent.
   */
  static override create(config: OrchestratorAgentConfig): OrchestratorAgent {
    return new OrchestratorAgent(config);
  }

  protected constructor(config: OrchestratorAgentConfig) {
    // Build default instructions if not provided
    const orchestratorConfig: AgentConfig = {
      ...config,
      instructions: config.instructions ?? DEFAULT_ORCHESTRATOR_INSTRUCTIONS,
      // Orchestrator should have working memory for its own scratch space
      context: mergeContextConfig(config.context, {
        features: { workingMemory: true },
      }),
    };

    // Call Agent constructor (creates AgentContextNextGen, registers tools, etc.)
    super(orchestratorConfig);

    // Resolve orchestration config with defaults
    this._orchestrationConfig = {
      maxTotalWorkerIterations: config.orchestration?.maxTotalWorkerIterations ?? 200,
      maxParallelWorkers: config.orchestration?.maxParallelWorkers ?? 5,
      workerTimeout: config.orchestration?.workerTimeout ?? 300_000,
      maxPlanSteps: config.orchestration?.maxPlanSteps ?? 30,
    };

    // Create ArtifactRegistry
    this._artifactRegistry = new ArtifactRegistry();

    // Create WorkerPool
    this._workerPool = new WorkerPool({
      registry: this._artifactRegistry,
      defaultConnector: config.connector,
      defaultModel: config.model,
      roles: config.workers,
    });

    // Create and register PlanPlugin on orchestrator's context
    this._planPlugin = new PlanPlugin({
      registry: this._artifactRegistry,
      workerPool: this._workerPool,
      maxPlanSteps: this._orchestrationConfig.maxPlanSteps,
    });
    this.context.registerPlugin(this._planPlugin);
  }

  // === Public API ===

  /** The artifact registry shared across all workers */
  get artifacts(): ArtifactRegistry { return this._artifactRegistry; }

  /** The worker pool managing worker agents */
  get workers(): WorkerPool { return this._workerPool; }

  /** The current plan state */
  get plan(): PlanState { return this._planPlugin.plan; }

  // === Agent Type ===

  protected override getAgentType(): string {
    return 'orchestrator-agent';
  }

  // === Lifecycle ===

  override destroy(): void {
    this._workerPool.destroy();
    // ArtifactRegistry has no resources to clean up
    super.destroy();
  }

  // === Session Persistence ===

  override async getContextState(): Promise<SerializedContextState> {
    const baseState = await super.getContextState();
    return {
      ...baseState,
      // Add orchestrator-specific state
      _orchestrator: {
        artifacts: this._artifactRegistry.getState(),
        plan: this._planPlugin.getState(),
      },
    };
  }

  override async restoreContextState(state: SerializedContextState): Promise<void> {
    await super.restoreContextState(state);
    // Restore orchestrator-specific state
    const orchState = (state as any)._orchestrator;
    if (orchState) {
      if (orchState.artifacts) this._artifactRegistry.restoreState(orchState.artifacts);
      if (orchState.plan) this._planPlugin.restoreState(orchState.plan);
    }
  }
}

// === Helper ===

function mergeContextConfig(
  existing: AgentContextNextGen | AgentContextNextGenConfig | undefined,
  defaults: Partial<AgentContextNextGenConfig>
): AgentContextNextGenConfig | AgentContextNextGen | undefined {
  // If user provided an instance, use it directly (they manage it)
  if (existing instanceof AgentContextNextGen) return existing;

  // Merge config objects
  const config = (existing as AgentContextNextGenConfig) ?? {};
  return {
    ...config,
    features: {
      ...defaults.features,
      ...config.features,
    },
  };
}

const DEFAULT_ORCHESTRATOR_INSTRUCTIONS = `You are an orchestrator agent coordinating a team of specialized workers to accomplish complex goals.

Your approach:
1. Understand the user's goal thoroughly
2. Create a structured plan using update_plan
3. Assign tasks to appropriate workers using assign_task
4. Monitor artifacts and progress
5. Iterate: review results, adjust plan, assign follow-up tasks
6. When the goal is achieved, provide a comprehensive final response

Key principles:
- Break complex goals into manageable steps with clear dependencies
- Assign the right role for each task
- Review worker output before moving to dependent steps
- Adjust the plan when things don't go as expected
- Use run_parallel for independent tasks to save time`;
```

### Key Design Decisions

1. **`extends Agent` — IS-A relationship** — OrchestratorAgent is a regular Agent. It has the full agentic loop, streaming, hooks, sessions, permissions. The orchestration happens entirely through plugins and tools.

2. **Override `create()` with `OrchestratorAgentConfig`** — Users call `OrchestratorAgent.create()` just like `Agent.create()`. TypeScript overrides the return type correctly.

3. **ArtifactRegistry created in constructor** — Owned by OrchestratorAgent. Passed to both WorkerPool and PlanPlugin. Single instance shared across all workers.

4. **PlanPlugin registered via `context.registerPlugin()`** — Follows the exact same pattern as built-in plugins. Auto-registers its tools with the orchestrator's ToolManager.

5. **Session persistence via `getContextState()/restoreContextState()`** — Overrides the BaseAgent methods to include artifact and plan state. This means `orchestrator.saveSession()` / `orchestrator.loadSession()` automatically persist the full orchestration state.

6. **Default instructions** — Provides a good default system prompt for the orchestrator LLM. User can override via `config.instructions`.

7. **Default features: workingMemory=true** — Orchestrator gets working memory for its own scratch space. This is separate from PlanPlugin — the orchestrator can store its reasoning, decisions, etc.

---

## 8. Orchestration Tools

Tools provided by PlanPlugin to the orchestrator agent. These are the tools the orchestrator LLM calls to coordinate workers.

### assign_task

```typescript
// Tool: assign_task
// Registered by: PlanPlugin.getTools()
// Available to: Orchestrator agent only

{
  definition: {
    type: 'function',
    function: {
      name: 'assign_task',
      description: 'Assign a task to a worker agent. The worker will run autonomously and return a result. Workers can read/write shared artifacts based on their role scope.',
      parameters: {
        type: 'object',
        properties: {
          role: {
            type: 'string',
            description: 'Worker role to assign to.',
            // enum dynamically populated from workerPool.listRoles()
          },
          prompt: {
            type: 'string',
            description: 'Detailed task description for the worker. Be specific about what to do, what artifacts to consult, and what to produce.',
          },
          step_id: {
            type: 'string',
            description: 'Optional: plan step ID this task corresponds to. Status will be auto-updated.',
          },
        },
        required: ['role', 'prompt'],
      },
    },
  },
  execute: async (args) => {
    const { role, prompt, step_id } = args;

    // Update plan step status
    if (step_id) {
      this._planPlugin.updateStepStatus(step_id, 'in_progress');
    }

    // Delegate to worker pool
    const result = await this._workerPool.assign(role, {
      prompt,
      stepId: step_id,
    });

    // Update plan step with result
    if (step_id) {
      this._planPlugin.updateStepStatus(
        step_id,
        result.success ? 'done' : 'failed',
        result.success
          ? `Completed. ${result.publishedArtifacts.map(a => `Published ${a.key} v${a.version}`).join('. ')}`
          : `Failed: ${result.error}`
      );
    }

    // Return summary to orchestrator (not the full worker output — save tokens)
    return {
      success: result.success,
      output_summary: result.output.substring(0, 500),
      published_artifacts: result.publishedArtifacts.map(a => ({
        key: a.key, version: a.version, summary: a.summary,
      })),
      metrics: result.metrics,
      error: result.error,
    };
  },
  permission: { scope: 'auto', riskLevel: 'medium' },
  describeCall: (args) => `assign ${args.role}: "${(args.prompt as string).substring(0, 60)}..."`,
}
```

### run_parallel

```typescript
// Tool: run_parallel
{
  definition: {
    type: 'function',
    function: {
      name: 'run_parallel',
      description: 'Run multiple tasks in parallel across workers. Use when tasks are independent (no dependencies between them). Each task gets its own worker instance.',
      parameters: {
        type: 'object',
        properties: {
          assignments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', description: 'Worker role.' },
                prompt: { type: 'string', description: 'Task description.' },
                step_id: { type: 'string', description: 'Optional plan step ID.' },
              },
              required: ['role', 'prompt'],
            },
            description: 'Array of task assignments to run concurrently.',
          },
        },
        required: ['assignments'],
      },
    },
  },
  execute: async (args) => {
    const assignments = args.assignments as WorkerAssignment[];

    // Enforce parallel limit
    const maxParallel = this._orchestrationConfig.maxParallelWorkers;
    if (assignments.length > maxParallel) {
      return { error: `Too many parallel tasks: ${assignments.length} > limit of ${maxParallel}` };
    }

    // Mark steps as in_progress
    for (const a of assignments) {
      if (a.task?.stepId) {
        this._planPlugin.updateStepStatus(a.task.stepId, 'in_progress');
      }
    }

    // Run in parallel
    const results = await this._workerPool.assignParallel(
      assignments.map(a => ({
        role: a.role,
        task: { prompt: a.prompt, stepId: a.step_id },
      }))
    );

    // Update step statuses and format results
    const summaries = results.map((result, i) => {
      const a = assignments[i];
      if (a.step_id) {
        this._planPlugin.updateStepStatus(a.step_id,
          result.success ? 'done' : 'failed',
          result.success ? `Completed` : `Failed: ${result.error}`
        );
      }
      return {
        role: a.role,
        step_id: a.step_id,
        success: result.success,
        output_summary: result.output.substring(0, 300),
        published_artifacts: result.publishedArtifacts.map(a => ({
          key: a.key, version: a.version, summary: a.summary,
        })),
        error: result.error,
      };
    });

    return { results: summaries };
  },
  permission: { scope: 'auto', riskLevel: 'medium' },
  describeCall: (args) => `parallel: ${(args.assignments as any[]).length} tasks`,
}
```

### update_plan

```typescript
// Tool: update_plan
{
  definition: {
    type: 'function',
    function: {
      name: 'update_plan',
      description: 'Create or update the execution plan. Call this to establish your strategy before assigning tasks. You can call it again to modify the plan as work progresses.',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: 'The overall goal being worked toward.',
          },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Step identifier (e.g., "1", "2a", "review-1").' },
                description: { type: 'string', description: 'What this step accomplishes.' },
                dependencies: {
                  type: 'array', items: { type: 'string' },
                  description: 'IDs of steps that must complete before this one.',
                },
              },
              required: ['id', 'description'],
            },
            description: 'Steps to add or replace. Existing steps with matching IDs are updated; new IDs are added.',
          },
        },
      },
    },
  },
  execute: async (args) => {
    const goal = args.goal as string | undefined;
    const stepsInput = args.steps as Array<{ id: string; description: string; dependencies?: string[] }> | undefined;

    if (stepsInput) {
      const existingSteps = this._planPlugin.plan.steps;
      const updatedSteps: PlanStep[] = [];

      // Merge: update existing by ID, add new
      const inputMap = new Map(stepsInput.map(s => [s.id, s]));

      // Keep existing steps, update if new input has same ID
      for (const existing of existingSteps) {
        const update = inputMap.get(existing.id);
        if (update) {
          updatedSteps.push({
            ...existing,
            description: update.description,
            dependencies: update.dependencies ?? existing.dependencies,
          });
          inputMap.delete(existing.id);
        } else {
          updatedSteps.push(existing);
        }
      }

      // Add new steps
      for (const newStep of inputMap.values()) {
        updatedSteps.push({
          id: newStep.id,
          description: newStep.description,
          status: 'pending',
          dependencies: newStep.dependencies ?? [],
        });
      }

      this._planPlugin.updatePlan({ goal, steps: updatedSteps });
    } else if (goal) {
      this._planPlugin.updatePlan({ goal });
    }

    return {
      success: true,
      plan: {
        goal: this._planPlugin.plan.goal,
        steps: this._planPlugin.plan.steps.map(s => ({
          id: s.id, description: s.description, status: s.status,
          dependencies: s.dependencies,
        })),
      },
    };
  },
  permission: { scope: 'always', riskLevel: 'low' },
  describeCall: (args) => `update plan${args.goal ? `: "${(args.goal as string).substring(0, 40)}"` : ''}`,
}
```

---

## 9. Worker Tools

Tools available to workers, provided by SharedContextPlugin (defined in Section 4):

| Tool | Provided To | Description |
|------|------------|-------------|
| `artifact_get(key)` | Workers with readable scope | Load full artifact content |
| `artifact_query(key, path)` | Workers with readable scope | Query into artifact structure |
| `artifact_publish(key, type, content, summary)` | Workers with writable scope | Publish/update an artifact |

Plus any role-specific tools configured in `WorkerRoleConfig.tools` (filesystem, bash, web, etc.).

Plus existing plugin tools if features are enabled (memory_store, memory_retrieve, etc. — private to each worker).

**Permission model:**
- Artifact tools: `{ scope: 'always', riskLevel: 'low' }` — no approval needed
- Role tools: inherit their own permission settings (e.g., bash requires approval)
- Memory tools: `{ scope: 'always', riskLevel: 'low' }` — standard

---

## 10. Integration with Agent/Context System

### How OrchestratorAgent Fits the Class Hierarchy

```
BaseAgent (abstract)
  └── Agent (agentic loop, hooks, streaming)
       └── OrchestratorAgent (workers, artifacts, plan)
```

**No changes to BaseAgent or Agent needed.** OrchestratorAgent extends Agent and:
- Calls `super(config)` in constructor → full Agent initialization
- Calls `this.context.registerPlugin()` → adds PlanPlugin after context is created
- Overrides `destroy()` → cleans up WorkerPool + calls super
- Overrides `getContextState()/restoreContextState()` → adds artifact/plan state

### How Plugins Integrate

```
AgentContextNextGen (orchestrator's)
  _plugins: Map
    ├── 'working_memory'     → WorkingMemoryPluginNextGen (existing, optional)
    ├── 'in_context_memory'  → InContextMemoryPluginNextGen (existing, optional)
    ├── 'orchestrator_plan'  → PlanPlugin (NEW, always)
    └── ... other existing plugins

AgentContextNextGen (worker's)
  _plugins: Map
    ├── 'working_memory'     → WorkingMemoryPluginNextGen (existing, opt-in per role)
    ├── 'shared_context'     → SharedContextPlugin (NEW, always)
    └── ... other existing plugins
```

PlanPlugin and SharedContextPlugin follow the **exact same interface** as all existing plugins:
- `getInstructions()` → static text in system message
- `getContent()` → dynamic content in system message, refreshed on each `prepare()`
- `getTools()` → tools auto-registered with ToolManager
- `getState()/restoreState()` → session persistence
- `invalidateTokenCache()` → token budget recalculation

### How the Agentic Loop Works

The orchestrator's agentic loop is **the standard Agent loop** — no modifications:

```
prepare() → LLM call → extract tool calls → execute tools → add results → repeat
```

The "magic" is that `assign_task` and `run_parallel` tools internally create and run worker Agents. From the orchestrator Agent's perspective, these are just slow tool calls that return results.

### Token Budget Interaction

```
Orchestrator's context budget (e.g., 128K tokens):
  System message: ~2000 tokens
    ├── System prompt: ~300 tokens
    ├── PlanPlugin instructions: ~400 tokens
    ├── PlanPlugin content: ~500-2000 tokens (plan + artifacts + changes)
    ├── WorkingMemory instructions: ~500 tokens
    └── WorkingMemory index: variable
  Tools: ~2000-3000 tokens (assign_task + run_parallel + update_plan + memory tools)
  Conversation: variable (orchestrator's own history)
  Current input: variable

Worker's context budget (e.g., 128K tokens):
  System message: ~800 tokens
    ├── Role instructions: ~300 tokens
    ├── SharedContextPlugin instructions: ~200 tokens
    ├── SharedContextPlugin content: ~100-500 tokens (artifact summaries)
    └── WorkingMemory (if enabled): ~500 tokens
  Tools: ~1000-3000 tokens (artifact tools + role tools)
  Conversation: variable (worker's own history — typically short for single-task)
  Current input: task prompt
```

Workers are typically **short-lived** with small conversation histories. Most of their context budget goes to role tools and task prompt. Artifact summaries are cheap (one line each).

---

## 11. Streaming & Events

OrchestratorAgent inherits Agent's streaming. When the orchestrator LLM generates text or calls tools, standard `StreamEvent`s are emitted.

For worker execution, the `assign_task` tool blocks until the worker completes. During this time, the orchestrator's stream is paused (no events emitted). When the tool returns, the stream resumes with the tool result.

**Future enhancement (Phase 2):** Proxy worker stream events through the orchestrator's stream with a `source` field:

```typescript
// Future: Nested stream events
interface OrchestratorStreamEvent extends StreamEvent {
  source?: {
    role: string;
    type: 'worker';
  };
}
```

For v1, the simpler model is sufficient: orchestrator streams normally, worker execution appears as a tool call that takes time.

---

## 12. Configuration & Factory Methods

### Minimal Configuration

```typescript
const orchestrator = OrchestratorAgent.create({
  connector: 'anthropic',
  model: 'claude-sonnet-4-6',
  workers: {
    planner: {
      instructions: 'Create detailed, actionable plans.',
      scope: { role: 'planner', readable: [], writable: ['plan'] },
    },
    implementer: {
      instructions: 'Write clean, production-ready code.',
      tools: [readFile, writeFile, editFile, bash, glob, grep],
      scope: { role: 'implementer', readable: ['plan', 'review'], writable: ['code'] },
    },
    reviewer: {
      instructions: 'Provide thorough, constructive code reviews.',
      tools: [readFile, glob, grep],
      scope: { role: 'reviewer', readable: ['plan', 'code'], writable: ['review'] },
    },
  },
});

const result = await orchestrator.run('Build a REST API for user management');
```

### Full Configuration

```typescript
const orchestrator = OrchestratorAgent.create({
  // Standard Agent config
  connector: 'anthropic',
  model: 'claude-opus-4-6',       // Stronger model for orchestration
  name: 'project-orchestrator',
  instructions: 'You manage a software development team...',
  temperature: 0.5,
  maxIterations: 50,               // Orchestrator's own iteration limit
  userId: 'user-123',

  // Context features for orchestrator
  context: {
    features: {
      workingMemory: true,          // Orchestrator's scratch space
      inContextMemory: true,        // Track key decisions in-context
    },
  },

  // Session persistence
  session: {
    storage: createFileContextStorage('project-orchestrator'),
    autoSave: true,
  },

  // Worker definitions
  workers: {
    planner: {
      model: 'claude-sonnet-4-6',  // Cheaper model for planning
      instructions: 'You are a technical planner...',
      scope: { role: 'planner', readable: [], writable: ['plan'] },
      maxIterations: 10,
      temperature: 0.3,             // More deterministic for planning
    },
    implementer: {
      model: 'claude-sonnet-4-6',
      instructions: 'You are an expert developer...',
      tools: [readFile, writeFile, editFile, bash, glob, grep, listDirectory],
      features: { workingMemory: true },  // Workers get scratch space
      scope: { role: 'implementer', readable: ['plan', 'review'], writable: ['code'] },
      maxIterations: 30,
      reuse: true,                  // Keep context between assignments
    },
    reviewer: {
      model: 'claude-sonnet-4-6',
      instructions: 'You are a senior code reviewer...',
      tools: [readFile, glob, grep],
      scope: { role: 'reviewer', readable: ['plan', 'code'], writable: ['review'] },
      maxIterations: 15,
    },
    researcher: {
      model: 'claude-sonnet-4-6',
      instructions: 'You research technical topics...',
      tools: [webSearch, webScrape],
      scope: { role: 'researcher', readable: ['plan'], writable: ['research'] },
    },
  },

  // Orchestration limits
  orchestration: {
    maxTotalWorkerIterations: 300,
    maxParallelWorkers: 3,
    workerTimeout: 600_000,         // 10 min per worker
    maxPlanSteps: 20,
  },

  // Standard Agent hooks (work normally)
  lifecycleHooks: {
    beforeToolExecution: async (ctx) => {
      console.log(`Tool: ${ctx.toolCall.name}`);
    },
    afterToolExecution: async (result) => {
      console.log(`Result: ${result.success}`);
    },
  },
});
```

### Using with Streaming

```typescript
for await (const event of orchestrator.stream('Build a REST API')) {
  switch (event.type) {
    case 'response.output_text.delta':
      process.stdout.write(event.delta);
      break;
    case 'response.function_call_arguments.done':
      console.log(`\n[Tool: ${event.name}]`);
      break;
    case 'response.completed':
      console.log('\n[Done]');
      break;
  }
}
```

### Accessing Results After Run

```typescript
const result = await orchestrator.run('Build a REST API');

// Standard Agent response
console.log(result.output_text);
console.log(result.usage);

// Orchestrator-specific
console.log(orchestrator.plan);              // Current plan state
console.log(orchestrator.artifacts.list());  // All published artifacts
const code = orchestrator.artifacts.get('code');
if (code) {
  console.log(code.content);               // Full code artifact
}
```

---

## 13. Error Handling & Edge Cases

### Worker Failures

| Scenario | Handling |
|----------|---------|
| Worker throws exception | Caught in WorkerPool.assign(), returned as `{ success: false, error }` |
| Worker hits max iterations | Agent.run() returns normally with incomplete work; WorkerResult.success may be true |
| Worker timeout | Future: wrap agent.run() in Promise.race with timeout |
| Worker produces empty output | WorkerResult.output is empty string; orchestrator LLM decides what to do |
| Unknown role name | WorkerPool returns error immediately, no agent created |
| Parallel worker writes same artifact | Last write wins (no locking). Orchestrator should avoid this via task design |

### Orchestrator Edge Cases

| Scenario | Handling |
|----------|---------|
| Orchestrator hits max iterations | Standard Agent behavior: wrap-up response without tools |
| No plan created | PlanPlugin content says "No plan yet"; orchestrator LLM should call update_plan |
| Artifact gets too large | Token estimate shown in PlanPlugin content; orchestrator can decide to trim |
| Worker publishes unexpected artifact key | ArtifactRegistry accepts any key; scope enforcement is on read/write tools only |
| Circular plan dependencies | No enforcement in v1; orchestrator LLM should avoid this |

### Resource Protection

- **Max parallel workers**: Enforced by `run_parallel` tool before execution
- **Max plan steps**: Enforced by `update_plan` tool
- **Worker iteration limits**: Per-role `maxIterations` passed to `agent.run()`
- **Worker timeout**: Configurable in orchestration config (implemented via AbortSignal or Promise.race)

---

## 14. Session Persistence

OrchestratorAgent session persistence includes:

1. **Standard Agent state** — Conversation history, plugin states (working memory, in-context memory)
2. **Artifact registry state** — All current artifacts with their content, versions, change log
3. **Plan state** — Goal, steps, statuses, recent changes

Persisted via the existing `saveSession()/loadSession()` mechanism (overridden `getContextState()/restoreContextState()`).

```typescript
// Save
await orchestrator.saveSession('my-session');

// Later: resume
const orchestrator2 = OrchestratorAgent.create({ ...sameConfig });
await orchestrator2.loadSession('my-session');
// orchestrator2 now has full conversation + plan + artifacts restored
```

**What's NOT persisted:**
- Worker Agent instances (re-created on next assignment)
- Active worker tracking (reset on load)
- ArtifactRegistry change listeners (re-registered on construction)

---

## 15. File Structure & Exports

### New Files

```
src/core/orchestrator/
├── index.ts                         # Barrel exports
├── ArtifactRegistry.ts              # Artifact storage (Section 3)
├── WorkerPool.ts                    # Worker lifecycle (Section 6)
├── OrchestratorAgent.ts             # Main class (Section 7)
├── plugins/
│   ├── PlanPlugin.ts                # Orchestrator context plugin (Section 5)
│   └── SharedContextPlugin.ts       # Worker context plugin (Section 4)
└── types.ts                         # Shared types
```

### Types File

```typescript
// src/core/orchestrator/types.ts

export type ArtifactType = 'plan' | 'code' | 'review' | 'data' | 'text';

export interface Artifact<T = unknown> { /* ... */ }
export interface ArtifactSummary { /* ... */ }
export interface ArtifactUpdate { /* ... */ }
export interface SerializedArtifactRegistryState { /* ... */ }

export interface WorkerScope { /* ... */ }
export interface WorkerRoleConfig { /* ... */ }
export interface WorkerTask { /* ... */ }
export interface WorkerResult { /* ... */ }
export interface WorkerAssignment { /* ... */ }
export interface ActiveWorkerInfo { /* ... */ }

export interface PlanStep { /* ... */ }
export interface PlanState { /* ... */ }

export interface OrchestratorAgentConfig extends AgentConfig { /* ... */ }
```

### Exports from src/index.ts

```typescript
// Add to src/index.ts

// Orchestrator
export { OrchestratorAgent } from './core/orchestrator/index.js';
export { ArtifactRegistry } from './core/orchestrator/index.js';
export { WorkerPool } from './core/orchestrator/index.js';
export { PlanPlugin } from './core/orchestrator/index.js';
export { SharedContextPlugin } from './core/orchestrator/index.js';

export type {
  OrchestratorAgentConfig,
  WorkerRoleConfig,
  WorkerScope,
  WorkerTask,
  WorkerResult,
  WorkerAssignment,
  Artifact,
  ArtifactSummary,
  ArtifactUpdate,
  ArtifactType,
  PlanStep,
  PlanState,
} from './core/orchestrator/index.js';
```

### No Changes to Existing Files

The orchestrator system requires **zero modifications** to existing files:
- `BaseAgent.ts` — unchanged
- `Agent.ts` — unchanged
- `AgentContextNextGen.ts` — unchanged
- `BasePluginNextGen.ts` — unchanged
- `ToolManager.ts` — unchanged

Everything is additive. PlanPlugin and SharedContextPlugin use the public `registerPlugin()` API. OrchestratorAgent uses the public `Agent.create()` pattern. WorkerPool uses `Agent.create()` to make workers.

---

## 16. Implementation Order

### Phase 1: Core (Minimal Working Orchestrator)

1. **`types.ts`** — All type definitions
2. **`ArtifactRegistry.ts`** — Publish, get, query, list, version tracking, serialization
3. **`SharedContextPlugin.ts`** — Plugin with artifact_get, artifact_query, artifact_publish tools
4. **`WorkerPool.ts`** — Role registration, assign, assignParallel, worker creation
5. **`PlanPlugin.ts`** — Plan state, renderers, assign_task + update_plan + run_parallel tools
6. **`OrchestratorAgent.ts`** — Wiring: creates registry, pool, plugin; extends Agent
7. **`index.ts`** — Barrel exports
8. **Update `src/index.ts`** — Add orchestrator exports
9. **Tests** — Unit tests for each component + integration test for full workflow

**Estimated: ~1500-2000 lines of implementation + ~1000 lines of tests**

### Phase 2: Hardening

- Worker timeout enforcement (AbortSignal integration)
- Total worker iteration tracking
- Metrics collection (per-worker token usage, durations)
- Error recovery (retry failed workers)
- Streaming event proxying from workers

### Phase 3: Artifact Schemas (Optional)

- JSON Schema validation on publish
- Schema registration in ArtifactRegistry
- Structured output enforcement for workers (responseFormat)

### Phase 4: Phase Framework (Optional, Approach D)

- PhaseManager class
- Phase transition rules
- Phase-aware scoping
- complete_phase / advance_phase tools

---

**End of Document**
