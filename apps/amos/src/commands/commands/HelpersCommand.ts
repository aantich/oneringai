import { getModelInfo } from '@everworker/oneringai';
import type { HelperRole, ModelExecutionConfig, ReasoningEffort } from '@everworker/oneringai';
import { BaseCommand } from '../BaseCommand.js';
import type { CommandContext, CommandResult } from '../../config/types.js';

const roles: HelperRole[] = ['compactor', 'extractor', 'verifier'];

export class HelpersCommand extends BaseCommand {
  readonly name = 'helpers';
  readonly aliases = ['helper'];
  readonly description = 'Configure explicit helper models and inspect task usage';
  readonly usage = '/helpers [set <role> <connector> <model> [effort]|off [role]|usage|run <role> <text>|compact|budget <calls> <tokens>]';
  get detailedHelp(): string {
    return `${this.usage}\n\nRoles: compactor, extractor, verifier. Helpers are disabled by default.\n`
      + 'Setting a role makes no model calls. Explicit run/compact makes one additional billable call, with at most one JSON repair.\n'
      + 'Compactor configuration authorizes older conversation text to be sent to that named connector; opaque provider state is omitted.\n'
      + 'Automatic compaction remains algorithmic. /helpers compact performs an explicit rollover and keeps two recent turns.\n'
      + 'Budgets use conservative provider-capacity reservations; retries with missing usage remain unknown.\n'
      + 'Usage lists purposes, known tokens/cost estimates and unknown usage; it is process-local diagnostic data.\n';
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const { app, args } = context;
    const [action, ...rest] = args;
    try {
      if (!action) {
        const config = app.getConfig().modelExecution;
        const lines = roles.map(role => {
          const p = config?.helpers?.[role];
          const reasoning = p?.thinking?.effort ?? (p?.thinking?.enabled === true ? 'enabled' : p?.thinking?.enabled === false ? 'disable requested' : 'provider default');
          return `${role}: ${p ? `${p.connector} / ${p.model} / reasoning ${reasoning}` : 'disabled'}`;
        });
        return this.success(`${lines.join('\n')}\n\n${this.detailedHelp}`);
      }
      if (action === 'usage') {
        const snapshot = app.getAgent()?.getModelUsage?.();
        if (!snapshot) return this.success('No model-task usage recorded yet. Helpers and task tracking are disabled by default.');
        const lines = snapshot.invocations.map(call => `${call.purpose}/${call.phase}: ${call.connector} / ${call.model} — ${call.status}${call.outputValidation ? `, output validation ${call.outputValidation}` : ''}; `
          + (call.usage ? `${call.usage.total_tokens} tokens` : 'usage unknown')
          + `; model cost ${call.modelCostUSD === null ? 'unknown' : `$${call.modelCostUSD.toFixed(6)}`}`);
        lines.push(`Attempts: ${snapshot.totals.calls}; unknown-charge attempts: ${snapshot.totals.unknownChargeAttempts}`);
        lines.push(`Known token subtotal: ${snapshot.totals.totalTokens}; unknown/pending usage: ${snapshot.totals.unknownUsageInvocations}`);
        lines.push(`Unknown/pending model costs: ${snapshot.totals.unknownCostInvocations}`);
        return this.success(lines.join('\n'));
      }
      const runner = app.getAgent();
      if (runner?.isRunning()) return this.error('Wait for the active operation before changing or invoking helpers.');
      if (action === 'run') {
        const role = rest.shift() as HelperRole;
        if (!roles.includes(role) || !rest.length) return this.error('Use /helpers run <role> <text>.');
        if (!runner?.invokeHelper) return this.error('Initialize an agent before invoking a helper.');
        return this.success(await runner.invokeHelper(role, rest.join(' ')));
      }
      if (action === 'compact') {
        if (!runner?.compactWithHelper) return this.error('Initialize an agent before compacting.');
        return this.success(await runner.compactWithHelper());
      }
      let next: ModelExecutionConfig | null = structuredClone(app.getConfig().modelExecution ?? {});
      if (action === 'off') {
        if (!rest.length) next = null;
        else {
          const role = rest[0] as HelperRole;
          if (!roles.includes(role)) return this.error('Unknown helper role.');
          if (next.helpers) delete next.helpers[role];
        }
      } else if (action === 'budget') {
        const [maxCalls, maxTokens] = rest.map(Number);
        if (!maxCalls || !maxTokens || !Number.isSafeInteger(maxCalls) || !Number.isSafeInteger(maxTokens) || maxCalls < 1 || maxTokens < 1) return this.error('Budget calls and tokens must be positive integers.');
        next.limits = { ...next.limits, maxCalls, maxTokens };
      } else if (action === 'set') {
        const [role, connectorName, model, effort] = rest;
        if (!roles.includes(role as HelperRole) || !connectorName || !model) return this.error('Use /helpers set <role> <connector> <model> [effort].');
        const connector = app.getConnectorManager().get(connectorName);
        const info = getModelInfo(model);
        if (!connector || !info?.isActive || connector.vendor !== info.provider) return this.error('Choose an accessible connector and an active model from its vendor.');
        if (effort && !info.features.reasoningEfforts?.includes(effort as ReasoningEffort)) return this.error(`Unsupported reasoning effort. Allowed: ${info.features.reasoningEfforts?.join(', ') ?? 'none configurable'}.`);
        next.helpers = { ...next.helpers, [role!]: { connector: connectorName, model, maxOutputTokens: 512,
          thinking: effort ? { enabled: true, effort: effort as ReasoningEffort } : { enabled: false }, allowContextTransfer: role === 'compactor' } };
        app.getConnectorManager().registerConnector(connectorName);
      } else return this.error(`Unknown helpers subcommand. ${this.usage}`);
      const previous = structuredClone(app.getConfig().modelExecution ?? null);
      const wasReady = runner?.isReady() ?? false;
      app.updateConfig({ modelExecution: next });
      try {
        if (wasReady) await app.createAgent();
        await app.saveConfig();
      } catch (error) {
        app.updateConfig({ modelExecution: previous });
        if (wasReady) {
          try { await app.createAgent(); }
          catch { return this.error('Helper configuration was restored, but the previous agent could not be reloaded. Reconnect before continuing.'); }
        }
        throw error;
      }
      return this.success(action === 'off' ? 'Helper configuration updated; no model calls made.'
        : 'Helper configuration saved; no model calls made. Explicit run/compact can make one additional call plus at most one repair.');
    } catch (error) { return this.error(error instanceof Error ? error.message : String(error)); }
  }
}
