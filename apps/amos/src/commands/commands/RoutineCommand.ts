import { Agent, createRoutineDefinition, createRoutineRunner } from '@everworker/oneringai';
import type { RoutineRunner, RoutineRunResult } from '@everworker/oneringai';
import { BaseCommand } from '../BaseCommand.js';
import type { CommandContext, CommandResult } from '../../config/types.js';

/** Host-driven synthetic demonstration; handles never enter AMOS saved configuration. */
export class RoutineCommand extends BaseCommand {
  readonly name = 'routine';
  readonly aliases = ['routines'];
  readonly description = 'Demonstrate verified same-process routine waiting and reconciliation';
  readonly usage = '/routine [demo|inspect|confirm|cancel]';
  private runner?: RoutineRunner;
  private result?: RoutineRunResult;
  private confirmed = false;
  get detailedHelp(): string { return `${this.usage}\nDemo makes one billable model call on the selected connector/model and uses synthetic local actions only.\nConfirm is a host assertion for this synthetic demo. Handles are process-local; no session restore or real provider-completion claim.`; }
  close(): void { this.runner?.close(); }
  async execute({ app, args }: CommandContext): Promise<CommandResult> {
    try {
      const action = args[0];
      if (!action) return this.success(this.detailedHelp);
      if (action === 'inspect') return this.success(this.result ? `${this.result.operationId}: ${this.result.state}\n${this.result.observations.map(value => `${value.phase}: ${value.verification?.kind ?? 'pending'}`).join('\n')}\nObserved host verification: ${this.result.state === 'completed' ? 'verified' : 'not verified'}\nModel accounting: ${this.result.accounting}; recorded calls: ${this.result.usage?.totals.calls ?? 'unknown'}\nContinuation: same process only; external completion requires host confirmation.` : 'No verified routine demo.');
      if (action === 'cancel') { this.close(); return this.success('Continuation revoked; cancellation requested. Settled synthetic actions are retained in the last inspection.'); }
      if (action === 'confirm') {
        if (!this.runner || !this.result || !('continuation' in this.result)) return this.error('No waiting demo to reconcile.');
        this.confirmed = true;
        this.result = await this.runner.resume(this.result.continuation, { authorize: () => true });
        return this.success(`Routine ${this.result.state}; the synthetic submission was not repeated.`);
      }
      if (action !== 'demo') return this.error(this.usage);
      if (this.result && 'continuation' in this.result) return this.error('Confirm or cancel the existing demo before starting another.');
      const config = app.getConfig();
      if (!config.activeConnector) return this.error('Select a connector first.');
      const model = config.activeModel || config.defaults.model;
      app.getConnectorManager().registerConnector(config.activeConnector);
      this.runner?.close(); this.confirmed = false;
      const definition = createRoutineDefinition({ name: 'AMOS verified demo', description: 'Synthetic accepted versus completed state',
        preSteps: [{ name: 'submission', toolName: 'demo_submit', args: {} }],
        tasks: [{ name: 'observe', description: 'Return DEMO_ACCEPTED exactly. No tool calls.' }],
      });
      this.runner = createRoutineRunner({ verify: observation => observation.phase === 'routine' || this.confirmed
        ? { kind: 'verified' } : { kind: 'waiting', reason: 'Synthetic host confirmation required' },
        onProgress: event => { if (event.kind === 'result') this.result = event.result; },
      });
      const adapter = this.runner.asTool({ definition, toolName: 'amos_verified_demo', createAgent: () => Agent.create({ connector: config.activeConnector!, model,
        thinking: { enabled: false }, context: { model, features: { workingMemory: false, inContextMemory: false } },
        modelExecution: { maxOutputTokensPerCall: 64 },
        tools: [{ definition: { type: 'function', function: { name: 'demo_submit', parameters: { type: 'object', properties: {} } } }, output: { effect: 'write' }, execute: async () => ({ id: 'synthetic-1', status: 'accepted' }) }],
      }) });
      const result = await adapter.execute({});
      return this.success(`Routine ${result.state}: ${result.operationId}. Use /routine inspect, then /routine confirm or /routine cancel.`);
    } catch (error) { return this.error(error instanceof Error ? error.message : String(error)); }
  }
}
