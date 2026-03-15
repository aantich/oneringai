/**
 * In-memory storage implementations (default, non-persistent)
 */

import { MemoryEntry, MemoryScope, scopeMatches } from '../../domain/entities/Memory.js';
import { Plan, Task, PlanStatus } from '../../domain/entities/Task.js';
import { AgentState, AgentStatus } from '../../domain/entities/AgentState.js';
import { IMemoryStorage } from '../../domain/interfaces/IMemoryStorage.js';
import { IPlanStorage } from '../../domain/interfaces/IPlanStorage.js';
import { IAgentStateStorage } from '../../domain/interfaces/IAgentStateStorage.js';

/**
 * In-memory implementation of IMemoryStorage
 */
export class InMemoryStorage implements IMemoryStorage {
  private store = new Map<string, MemoryEntry>();

  async get(key: string): Promise<MemoryEntry | undefined> {
    return this.store.get(key);
  }

  async set(key: string, entry: MemoryEntry): Promise<void> {
    this.store.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async getAll(): Promise<MemoryEntry[]> {
    return Array.from(this.store.values());
  }

  async getByScope(scope: MemoryScope): Promise<MemoryEntry[]> {
    return Array.from(this.store.values()).filter((entry) => scopeMatches(entry.scope, scope));
  }

  async clearScope(scope: MemoryScope): Promise<void> {
    const toDelete: string[] = [];
    for (const [key, entry] of this.store.entries()) {
      if (scopeMatches(entry.scope, scope)) {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) {
      this.store.delete(key);
    }
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async getTotalSize(): Promise<number> {
    let total = 0;
    for (const entry of this.store.values()) {
      total += entry.sizeBytes;
    }
    return total;
  }
}

/**
 * In-memory implementation of IPlanStorage
 */
export class InMemoryPlanStorage implements IPlanStorage {
  private plans = new Map<string, Plan>();

  async savePlan(plan: Plan): Promise<void> {
    // Deep clone to avoid mutations
    this.plans.set(plan.id, structuredClone(plan));
  }

  async getPlan(planId: string): Promise<Plan | undefined> {
    const plan = this.plans.get(planId);
    return plan ? structuredClone(plan) : undefined;
  }

  async updateTask(planId: string, task: Task): Promise<void> {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

    const taskIndex = plan.tasks.findIndex((t) => t.id === task.id);
    if (taskIndex === -1) {
      throw new Error(`Task ${task.id} not found in plan ${planId}`);
    }

    plan.tasks[taskIndex] = structuredClone(task);
  }

  async addTask(planId: string, task: Task): Promise<void> {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

    plan.tasks.push(structuredClone(task));
  }

  async deletePlan(planId: string): Promise<void> {
    this.plans.delete(planId);
  }

  async listPlans(filter?: { status?: PlanStatus[] }): Promise<Plan[]> {
    const allPlans = Array.from(this.plans.values());

    if (!filter || !filter.status) {
      return allPlans.map((p) => structuredClone(p));
    }

    return allPlans
      .filter((plan) => filter.status!.includes(plan.status))
      .map((p) => structuredClone(p));
  }

  async findByWebhookId(webhookId: string): Promise<{ plan: Plan; task: Task } | undefined> {
    for (const plan of this.plans.values()) {
      for (const task of plan.tasks) {
        if (task.externalDependency?.webhookId === webhookId) {
          return {
            plan: structuredClone(plan),
            task: structuredClone(task),
          };
        }
      }
    }
    return undefined;
  }
}

/**
 * In-memory implementation of IAgentStateStorage
 */
export class InMemoryAgentStateStorage implements IAgentStateStorage {
  private agents = new Map<string, AgentState>();

  async save(state: AgentState): Promise<void> {
    // Deep clone to avoid mutations
    this.agents.set(state.id, structuredClone(state));
  }

  async load(agentId: string): Promise<AgentState | undefined> {
    const state = this.agents.get(agentId);
    return state ? structuredClone(state) : undefined;
  }

  async delete(agentId: string): Promise<void> {
    this.agents.delete(agentId);
  }

  async list(filter?: { status?: AgentStatus[] }): Promise<AgentState[]> {
    const allStates = Array.from(this.agents.values());

    if (!filter || !filter.status) {
      return allStates.map((s) => structuredClone(s));
    }

    return allStates
      .filter((state) => filter.status!.includes(state.status))
      .map((s) => structuredClone(s));
  }

  async patch(agentId: string, updates: Partial<AgentState>): Promise<void> {
    const state = this.agents.get(agentId);
    if (!state) {
      throw new Error(`Agent ${agentId} not found`);
    }

    Object.assign(state, updates);
  }
}

/**
 * Unified agent storage interface
 */
export interface IAgentStorage {
  memory: IMemoryStorage;
  plan: IPlanStorage;
  agent: IAgentStateStorage;
}

/**
 * Create agent storage with defaults
 */
export function createAgentStorage(options: {
  memory?: IMemoryStorage;
  plan?: IPlanStorage;
  agent?: IAgentStateStorage;
} = {}): IAgentStorage {
  return {
    memory: options.memory ?? new InMemoryStorage(),
    plan: options.plan ?? new InMemoryPlanStorage(),
    agent: options.agent ?? new InMemoryAgentStateStorage(),
  };
}

// Re-export for convenience
export { InMemoryStorage as InMemoryMemoryStorage };
export type { IAgentStorage as InMemoryAgentStorage };
