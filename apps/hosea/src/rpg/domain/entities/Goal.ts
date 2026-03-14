import { GoalHierarchyError } from '../errors/DomainErrors.js';
import type { GoalType, GoalStatus } from '../types/Enums.js';
import type { SimulationTime } from '../types/SimulationTime.js';

export interface GoalParams {
  id?: string;
  description: string;
  type: GoalType;
  status?: GoalStatus;
  priority: number;
  progress?: number;
  deadline?: SimulationTime;
  parentGoal?: string;
  subGoals?: string[];
  prerequisites?: string[];
  conflicts?: string[];
  drivenBy?: string[];
  triggeredBy?: string;
  successCondition: string;
  failureCondition?: string;
}

const VALID_STATUSES: readonly GoalStatus[] = [
  'active',
  'paused',
  'completed',
  'failed',
  'abandoned',
];

/** Terminal statuses that cannot be transitioned out of. */
const TERMINAL_STATUSES: ReadonlySet<GoalStatus> = new Set(['completed', 'failed', 'abandoned']);

function clamp01(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new GoalHierarchyError(
      `Field "${field}" must be a finite number in [0, 1], got ${value}.`,
    );
  }
  return value;
}

export class Goal {
  readonly id: string;
  description: string;
  type: GoalType;
  status: GoalStatus;
  priority: number;
  progress: number;
  deadline?: SimulationTime;
  parentGoal?: string;
  subGoals: string[];
  prerequisites: string[];
  conflicts: string[];
  drivenBy: string[];
  triggeredBy?: string;
  successCondition: string;
  failureCondition?: string;

  constructor(params: GoalParams) {
    this.id = params.id ?? crypto.randomUUID();
    this.description = params.description;
    this.type = params.type;

    const status = params.status ?? 'active';
    if (!VALID_STATUSES.includes(status)) {
      throw new GoalHierarchyError(
        `Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')}.`,
      );
    }
    this.status = status;

    this.priority = clamp01(params.priority, 'priority');
    this.progress = clamp01(params.progress ?? 0, 'progress');

    this.deadline = params.deadline;
    this.parentGoal = params.parentGoal;
    this.subGoals = params.subGoals ? [...params.subGoals] : [];
    this.prerequisites = params.prerequisites ? [...params.prerequisites] : [];
    this.conflicts = params.conflicts ? [...params.conflicts] : [];
    this.drivenBy = params.drivenBy ? [...params.drivenBy] : [];
    this.triggeredBy = params.triggeredBy;
    this.successCondition = params.successCondition;
    this.failureCondition = params.failureCondition;
  }

  // ─── Lifecycle transitions ────────────────────────────────────────────────

  private assertNotTerminal(operation: string): void {
    if (TERMINAL_STATUSES.has(this.status)) {
      throw new GoalHierarchyError(
        `Cannot ${operation} goal "${this.id}" — it is already in terminal status "${this.status}".`,
      );
    }
  }

  pause(): void {
    if (this.status !== 'active') {
      throw new GoalHierarchyError(
        `Cannot pause goal "${this.id}" — current status is "${this.status}", expected "active".`,
      );
    }
    this.status = 'paused';
  }

  resume(): void {
    if (this.status !== 'paused') {
      throw new GoalHierarchyError(
        `Cannot resume goal "${this.id}" — current status is "${this.status}", expected "paused".`,
      );
    }
    this.status = 'active';
  }

  complete(): void {
    this.assertNotTerminal('complete');
    this.progress = 1;
    this.status = 'completed';
  }

  fail(): void {
    this.assertNotTerminal('fail');
    this.status = 'failed';
  }

  abandon(): void {
    this.assertNotTerminal('abandon');
    this.status = 'abandoned';
  }

  // ─── Progress & priority ──────────────────────────────────────────────────

  updateProgress(delta: number): void {
    this.assertNotTerminal('update progress of');
    const newProgress = Math.max(0, Math.min(1, this.progress + delta));
    this.progress = newProgress;
    if (this.progress >= 1.0) {
      this.complete();
    }
  }

  updatePriority(newPriority: number): void {
    this.priority = clamp01(newPriority, 'priority');
  }

  // ─── Sub-goal management ──────────────────────────────────────────────────

  addSubGoal(goalId: string): void {
    if (goalId === this.id) {
      throw new GoalHierarchyError(`Goal "${this.id}" cannot be its own sub-goal.`);
    }
    if (!this.subGoals.includes(goalId)) {
      this.subGoals.push(goalId);
    }
  }

  removeSubGoal(goalId: string): void {
    const index = this.subGoals.indexOf(goalId);
    if (index !== -1) {
      this.subGoals.splice(index, 1);
    }
  }

  // ─── Blocking logic ───────────────────────────────────────────────────────

  /**
   * Returns true if any prerequisite goal is not yet completed.
   */
  isBlocked(goalStatuses: Map<string, GoalStatus>): boolean {
    return this.prerequisites.some((prereqId) => {
      const prereqStatus = goalStatuses.get(prereqId);
      return prereqStatus !== 'completed';
    });
  }
}
