/** Example/test utility, not a new library API. Retains no prompts or payloads. */
import { createHash } from 'node:crypto';
import type { Agent, AgentEventName, AgentEvents } from '../../src/index.js';

export function canonicalJSON(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, sort(entry)]));
    }
    return item;
  };
  return JSON.stringify(sort(value));
}

export interface BaselineStep {
  id: string;
  runId: string;
  parentId: string;
  kind: 'llm' | 'tool';
  name: string;
  outcome: 'pending' | 'response' | 'library_completed' | 'error' | 'timeout';
  durationMs: number | null;
  usage: { input: number | null; output: number | null; total: number | null } | null;
  /** Payload-free completion diagnostics; an HTTP success is not fixture completion. */
  response?: { status: string; stopReason: string | null; textChars: number; textSHA256: string };
}

export interface BaselineRun {
  id: string;
  parentId: string;
  outcome: 'running' | 'completed' | 'cancelled' | 'error';
}

/** A known subtotal is distinct from a complete total. Never invent a zero. */
export function usageSummary(values: Array<number | null>): {
  knownSubtotal: number; missingCalls: number; total: number | null;
} {
  const missingCalls = values.filter(value => value === null).length;
  const knownSubtotal = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return { knownSubtotal, missingCalls, total: missingCalls ? null : knownSubtotal };
}

function knownNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export class BaselineReporter {
  private readonly runs = new Map<string, BaselineRun>();
  private readonly steps: BaselineStep[] = [];
  private readonly requests = new Map<string, BaselineStep[]>();
  private readonly tools = new Map<string, BaselineStep>();
  private readonly responseIds = new Set<string>();
  private readonly argumentHashes = new Set<string>();
  private readonly started = new Map<string, number>();
  private repeatedToolCalls = 0;
  private correlationErrors = 0;

  constructor(
    private readonly fixtureId: string,
    private readonly connector: string,
    private readonly model: string,
    private readonly now: () => number = () => performance.now(),
  ) {}

  attach(agent: Agent): () => void {
    const detach: Array<() => void> = [];
    const on = <K extends AgentEventName>(name: K, handler: (event: AgentEvents[K]) => void): void => {
      const listener = (...args: unknown[]): void => handler(args[0] as AgentEvents[K]);
      agent.on(name, listener);
      detach.push(() => { agent.off(name, listener); });
    };
    on('execution:start', event => {
      if (this.runs.has(event.executionId)) { this.correlationErrors++; return; }
      this.runs.set(event.executionId, {
        id: `${this.fixtureId}/run-${this.runs.size + 1}`, parentId: this.fixtureId, outcome: 'running',
      });
    });
    const finish = (executionId: string, outcome: BaselineRun['outcome']): void => {
      const run = this.runs.get(executionId);
      if (!run) { this.correlationErrors++; return; }
      if (run.outcome !== 'cancelled') run.outcome = outcome;
    };
    on('execution:complete', event => finish(event.executionId, 'completed'));
    on('execution:error', event => finish(event.executionId, 'error'));
    on('execution:cancelled', event => finish(event.executionId, 'cancelled'));
    on('llm:request', event => {
      const step = this.step(event.executionId, event.iteration, 'llm', this.model);
      if (!step) return;
      const key = `${event.executionId}/${event.iteration}`;
      this.requests.set(key, [...(this.requests.get(key) ?? []), step]);
    });
    on('llm:response', event => {
      const responseKey = `${event.executionId}/${event.iteration}/${event.response.id}`;
      if (this.responseIds.has(responseKey)) return;
      this.responseIds.add(responseKey);
      const step = this.pending(event.executionId, event.iteration);
      if (!step) return;
      step.outcome = 'response';
      const text = event.response.output_text ?? '';
      step.response = { status: event.response.status, stopReason: event.response.stop_reason ?? null,
        textChars: text.length, textSHA256: createHash('sha256').update(text).digest('hex') };
      step.name = event.response.model;
      step.durationMs = knownNumber(event.duration);
      step.usage = {
        input: knownNumber(event.response.usage?.input_tokens),
        output: knownNumber(event.response.usage?.output_tokens),
        total: knownNumber(event.response.usage?.total_tokens),
      };
    });
    on('llm:error', event => {
      const step = this.pending(event.executionId, event.iteration);
      if (step) { step.outcome = 'error'; step.durationMs = this.elapsed(step); }
    });
    on('tool:start', event => {
      const key = `${event.executionId}/${event.toolCall.id}`;
      if (this.tools.has(key)) { this.correlationErrors++; return; }
      const step = this.step(event.executionId, event.iteration, 'tool', event.toolCall.function.name);
      if (!step) return;
      this.tools.set(key, step);
      try {
        const args = canonicalJSON(JSON.parse(event.toolCall.function.arguments));
        const hash = createHash('sha256').update(`${step.name}/${args}`).digest('hex');
        if (this.argumentHashes.has(hash)) this.repeatedToolCalls++;
        this.argumentHashes.add(hash); // Internal only; hashes are not exported either.
      } catch { this.correlationErrors++; }
    });
    const toolFinish = (executionId: string, callId: string, outcome: BaselineStep['outcome']): void => {
      const step = this.tools.get(`${executionId}/${callId}`);
      if (!step) { this.correlationErrors++; return; }
      if (step.outcome !== 'pending') return;
      step.outcome = outcome;
      step.durationMs = this.elapsed(step);
    };
    on('tool:complete', event => toolFinish(event.executionId, event.toolCall.id, 'library_completed'));
    on('tool:error', event => toolFinish(event.executionId, event.toolCall.id, 'error'));
    on('tool:timeout', event => toolFinish(event.executionId, event.toolCall.id, 'timeout'));
    return () => { detach.splice(0).forEach(remove => remove()); };
  }

  private step(executionId: string, iteration: number, kind: BaselineStep['kind'], name: string): BaselineStep | null {
    const run = this.runs.get(executionId);
    if (!run) { this.correlationErrors++; return null; }
    const parentId = `${run.id}/iteration-${iteration}`;
    const step: BaselineStep = {
      id: `${parentId}/${kind}-${this.steps.length + 1}`, runId: run.id, parentId,
      kind, name, outcome: 'pending', durationMs: null, usage: null,
    };
    this.started.set(step.id, this.now());
    this.steps.push(step);
    return step;
  }

  private pending(executionId: string, iteration: number): BaselineStep | null {
    const step = this.requests.get(`${executionId}/${iteration}`)?.find(entry => entry.outcome === 'pending');
    if (!step) this.correlationErrors++;
    return step ?? null;
  }

  private elapsed(step: BaselineStep): number {
    return Math.max(0, this.now() - this.started.get(step.id)!);
  }

  report() {
    const llm = this.steps.filter(step => step.kind === 'llm');
    return structuredClone({
      fixtureId: this.fixtureId, connector: this.connector, model: this.model,
      runs: [...this.runs.values()], steps: this.steps,
      llmCalls: llm.length, toolCalls: this.steps.length - llm.length,
      repeatedToolCalls: this.repeatedToolCalls, correlationErrors: this.correlationErrors,
      usage: {
        input: usageSummary(llm.map(step => step.usage?.input ?? null)),
        output: usageSummary(llm.map(step => step.usage?.output ?? null)),
        total: usageSummary(llm.map(step => step.usage?.total ?? null)),
      },
    });
  }
}
