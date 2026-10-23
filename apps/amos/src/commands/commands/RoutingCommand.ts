import { getModelInfo } from '@everworker/oneringai';
import { BaseCommand } from '../BaseCommand.js';
import { describeRouting } from '../../agent/routing.js';
import type { AmosConfig, CommandContext, CommandResult } from '../../config/types.js';

export class RoutingCommand extends BaseCommand {
  readonly name = 'routing';
  readonly aliases = ['route'];
  readonly description = 'Configure named model routes, host hints and inspect decisions';
  readonly usage = '/routing [set <name> <connector> <model> [allow-transfer]|use <name|default|auto>|hints <taskType> [phase]|rule <taskType> <route>|off]';
  get detailedHelp(): string {
    return `${this.usage}\n\nDefault is the configured main model. Routing is opt-in and makes no selection LLM call.\n`
      + 'Rules match explicit host taskType hints, never classify the prompt. use auto enables those rules.\n'
      + 'allow-transfer explicitly permits sending managed context to the selected connector/account.\n'
      + 'A run stays on one route; incompatible native history is rejected before transfer. /helpers usage shows actual call attribution.\n'
      + 'AMOS hints do not create a cross-run ModelTask or enable phase stickiness automatically.\n';
  }
  async execute({ app, args }: CommandContext): Promise<CommandResult> {
    const [action, ...rest] = args;
    const config = app.getConfig(), runner = app.getAgent();
    if (!action) {
      const routes = Object.entries(config.modelExecution?.routing?.routes ?? {}).map(([name, route]) => `${name}: ${route.connector ?? config.activeConnector} / ${route.model}; transfer ${route.allowContextTransfer === true ? 'allowed' : 'not allowed'}`);
      const decision = runner?.getRoutingDiagnostics?.();
      return this.success([`Configured default: ${config.activeConnector} / ${config.activeModel}`, ...routes,
        `Host hints/choice: ${JSON.stringify(config.routing ?? null)}`, `Category rules: ${JSON.stringify(config.routingRules ?? {})}`,
        ...(decision ? [describeRouting(decision)] : ['No routing decision recorded.']), this.detailedHelp].join('\n'));
    }
    if (runner?.isRunning()) return this.error('Wait for the active operation before changing routing.');
    const next = structuredClone(config.modelExecution ?? {});
    let choice: AmosConfig['routing'] = structuredClone(config.routing ?? {});
    let rules: AmosConfig['routingRules'] = structuredClone(config.routingRules ?? {});
    let rebuild = false;
    const known = (name: string) => name === 'default' || !!next.routing && Object.hasOwn(next.routing.routes, name);
    const key = (name: string | undefined, max: number) => !!name && name.length <= max && !['__proto__', 'prototype', 'constructor'].includes(name);
    if (action === 'set') {
      const [name, connectorName, model, transfer] = rest;
      if (!key(name, 64) || name === 'default' || !connectorName || !model || rest.length > 4 || transfer && transfer !== 'allow-transfer') return this.error(this.usage);
      const connector = app.getConnectorManager().get(connectorName), info = getModelInfo(model);
      if (!connector || !info?.isActive || connector.vendor !== info.provider) return this.error('Choose an accessible connector and an active model from its vendor.');
      const routes = { ...next.routing?.routes, [name!]: { connector: connectorName, model, thinking: { enabled: false }, allowContextTransfer: transfer === 'allow-transfer' } };
      if (Object.keys(routes).length > 16) return this.error('At most 16 alternative routes are supported.');
      next.routing = { ...next.routing, routes }; rebuild = true;
      app.getConnectorManager().registerConnector(connectorName);
    } else if (action === 'use') {
      const name = rest[0];
      if (rest.length !== 1 || !name || name !== 'auto' && !known(name) || !next.routing) return this.error('Configure a route first, then use its name, default or auto.');
      choice = { ...choice }; delete choice.route;
      if (name !== 'auto') choice.route = name;
    } else if (action === 'hints') {
      const [taskType, phase] = rest;
      if (!next.routing || !key(taskType, 128) || phase !== undefined && !key(phase, 128) || rest.length > 2) return this.error('Use /routing hints <taskType> [phase] after configuring routes.');
      choice = { ...choice, taskType, ...(phase ? { phase } : {}) }; if (!phase) delete choice.phase;
    } else if (action === 'rule') {
      const [category, route] = rest;
      if (!next.routing || !key(category, 128) || !route || !known(route) || rest.length !== 2) return this.error('Use /routing rule <taskType> <configured-route|default>.');
      rules = { ...rules, [category!]: route }; rebuild = true;
    } else if (action === 'off' && !rest.length) {
      next.routing = null; choice = null; rules = null; rebuild = true;
    } else return this.error(this.usage);

    const previous = { modelExecution: config.modelExecution, routing: config.routing, routingRules: config.routingRules };
    const patch: Partial<AmosConfig> = { modelExecution: next, routing: choice, routingRules: rules };
    const wasReady = runner?.isReady() ?? false;
    let replaced = false;
    try {
      app.updateConfig({ modelExecution: null, routing: null, routingRules: null });
      app.updateConfig(patch);
      if (rebuild && wasReady) { await app.createAgent(); replaced = true; }
      await app.saveConfig();
      if (!rebuild) runner?.setRoutingOptions?.(choice);
      return this.success('Routing configuration saved. No model call made.');
    } catch {
      app.updateConfig({ modelExecution: null, routing: null, routingRules: null });
      app.updateConfig(previous);
      // Preserve absent legacy keys even with deep-merging settings adapters.
      const restored = app.getConfig();
      for (const field of ['modelExecution', 'routing', 'routingRules'] as const) if (previous[field] === undefined) delete restored[field];
      if (replaced && wasReady) {
        try { await app.createAgent(); }
        catch { return this.error('Routing settings restored; reconnect the previous agent before continuing.'); }
      }
      return this.error('Routing configuration could not be applied. Previous settings restored; existing provider-bound state was preserved.');
    }
  }
}
