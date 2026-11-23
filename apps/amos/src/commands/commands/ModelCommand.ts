/**
 * ModelCommand - Switch or list models at runtime
 */

import { BaseCommand } from '../BaseCommand.js';
import type { CommandContext, CommandResult } from '../../config/types.js';
import { Connector, createProvider, getModelsByVendor, getModelInfo, Vendor } from 'oneringai';

function formatTokenLimit(tokens: number | null): string {
  return tokens === null ? 'unknown' : `${(tokens / 1000).toFixed(0)}K tokens`;
}

export class ModelCommand extends BaseCommand {
  readonly name = 'model';
  readonly aliases = ['m'];
  readonly description = 'Switch model or list available models';
  readonly usage = '/model [name|list|info]';

  get detailedHelp(): string {
    return `
/model - Switch Model or List Available Models

View available models for the current vendor or switch to a different model.
Model changes require agent recreation.

USAGE:
  /model              List models for current vendor
  /model list         Same as above
  /model info         Show detailed info about current model
  /model <name>       Switch to specified model

EXAMPLES:
  /model                    List available models
  /model gpt-6-astra        Switch to GPT-6 Astra
  /model claude-opus-4-5    Switch to Claude Opus 4.5
  /model info               Show current model details

ALIASES:
  /m
`;
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const { args, app } = context;
    const config = app.getConfig();

    if (args.length === 0 || args[0] === 'list') {
      return this.listModels(context);
    }

    if (args[0] === 'info') {
      return this.showModelInfo(context);
    }

    // Switch to model
    const modelName = args[0];
    return this.switchModel(context, modelName);
  }

  private async listModels(context: CommandContext): Promise<CommandResult> {
    const { app } = context;
    const config = app.getConfig();
    const currentVendor = config.activeVendor || config.defaults.vendor;
    const currentModel = config.activeModel || config.defaults.model;
    if (currentVendor === Vendor.OMLX && config.activeConnector) {
      const provider = createProvider(Connector.get(config.activeConnector));
      const models = await provider.listModels();
      const labels = models.map(model => {
        const caps = provider.getModelCapabilities(model);
        const features = [caps.supportsVision ? 'vision' : '', caps.supportsTools ? 'tools' : ''].filter(Boolean);
        return `${model === currentModel ? '→ ' : '  '}${model}${features.length ? ` [${features.join(', ')}]` : ''}`;
      });
      return this.success(labels.length ? ['Installed oMLX models', ...labels].join('\n') : 'No text or vision models are installed in oMLX.');
    }
    const registryModel = getModelInfo(currentModel)?.name ?? currentModel;

    // Get models for current vendor
    const vendorModels = getModelsByVendor(currentVendor as any);

    if (vendorModels.length === 0) {
      const connectorModels = config.activeConnector
        ? app.getConnectorManager().getModelsForConnector(config.activeConnector)
        : [];
      if (connectorModels.length > 0) {
        const lines = [`Models configured for ${config.activeConnector}:`, ''];
        for (const model of connectorModels) {
          lines.push(`${model === currentModel ? '→ ' : '  '}${model}`);
        }
        return this.success(lines.join('\n'));
      }

      const lines = [
        `No models are registered for ${currentVendor}.`,
        '',
        `Current model: ${currentModel}`,
        'You can still switch to a provider-supported model by name:',
        '  /model <model-name>',
      ];
      return this.success(lines.join('\n'));
    }

    const lines = [
      `Models for ${currentVendor}:`,
      '',
    ];

    for (const model of vendorModels) {
      const marker = model.name === registryModel ? '→ ' : '  ';
      const features: string[] = [];
      if (model.features.vision) features.push('vision');
      if (model.features.reasoning) features.push('reasoning');
      if (model.features.functionCalling) features.push('tools');
      if (model.features.asyncToolCalling) features.push('async tools');
      if (model.features.midTurnSteering) features.push('steering');
      const featureStr = features.length > 0 ? ` [${features.join(', ')}]` : '';

      lines.push(`${marker}${model.name}${featureStr}`);
      lines.push(`    Context: ${formatTokenLimit(model.features.input.tokens)} in / ${formatTokenLimit(model.features.output.tokens)} out`);
    }

    lines.push('');
    lines.push('Usage: /model <model-name> to switch');

    return this.success(lines.join('\n'));
  }

  private async showModelInfo(context: CommandContext): Promise<CommandResult> {
    const { app } = context;
    const config = app.getConfig();
    const currentModel = config.activeModel || config.defaults.model;

    if (config.activeVendor === Vendor.OMLX && config.activeConnector) {
      const provider = createProvider(Connector.get(config.activeConnector));
      await provider.prepareModel?.(currentModel);
      const caps = provider.getModelCapabilities(currentModel);
      return this.success([
        `Model: ${currentModel}`,
        'Vendor: oMLX',
        `Context: ${formatTokenLimit(caps.maxTokens)}`,
        `Vision: ${caps.supportsVision ? 'supported' : 'unavailable'}`,
        `Function calling: ${caps.supportsTools ? 'supported' : 'unverified for this checkpoint'}`,
        `Native JSON schema: ${caps.supportsJSONSchema ? 'supported without tools' : 'unverified for this checkpoint'}`,
      ].join('\n'));
    }

    const modelInfo = getModelInfo(currentModel);

    if (!modelInfo) {
      return this.success(`Current model: ${currentModel}\n(No detailed info available)`);
    }

    const features = modelInfo.features;
    const featureFlags = [
      features.vision ? '✓ Vision' : '✗ Vision',
      features.reasoning ? '✓ Reasoning' : '✗ Reasoning',
      features.functionCalling ? '✓ Function Calling' : '✗ Function Calling',
      features.streaming ? '✓ Streaming' : '✗ Streaming',
      features.structuredOutput ? '✓ Structured Output' : '✗ Structured Output',
      features.asyncToolCalling ? '✓ Async Tool Calling' : '✗ Async Tool Calling',
      features.midTurnSteering ? '✓ Mid-turn Steering' : '✗ Mid-turn Steering',
      features.configurationUpdates ? '✓ Configuration Updates' : '✗ Configuration Updates',
      features.misalignmentMonitoring ? '✓ Misalignment Monitoring' : '✗ Misalignment Monitoring',
    ];

    const info = `
Model: ${modelInfo.name}
Vendor: ${modelInfo.provider}

Context Window:
  Input:  ${formatTokenLimit(features.input.tokens)}
  Output: ${formatTokenLimit(features.output.tokens)}

Pricing (per million tokens):
  Input:  $${features.input.cpm.toFixed(2)}
  Output: $${features.output.cpm.toFixed(2)}

Features:
  ${featureFlags.join('\n  ')}

Reasoning Efforts: ${features.reasoningEfforts?.join(', ') || '(not configurable)'}
Lifecycle: ${modelInfo.lifecycle ?? 'unknown'}
Availability: ${modelInfo.availability ?? 'standard'}

Release: ${modelInfo.releaseDate || 'Unknown'}
`;

    return this.success(info);
  }

  private async switchModel(context: CommandContext, modelName: string): Promise<CommandResult> {
    const { app } = context;
    const config = app.getConfig();
    const omlx = config.activeVendor === Vendor.OMLX && config.activeConnector;
    if (omlx) await createProvider(Connector.get(omlx)).prepareModel?.(modelName);

    // Validate model exists (either in registry or accept any)
    const modelInfo = getModelInfo(modelName);

    // Update config
    app.updateConfig({ activeModel: modelName });

    // Recreate agent with new model (model change requires agent recreation)
    try {
      await app.createAgent();
      await app.saveConfig();
    } catch (error) {
      if (omlx) app.updateConfig({ activeModel: config.activeModel });
      return this.error(`Failed to switch model: ${error instanceof Error ? error.message : String(error)}`);
    }

    const infoStr = omlx ? ' (oMLX)' : modelInfo
      ? ` (${modelInfo.provider})`
      : ' (custom model)';

    return this.success(`Switched to model: ${modelName}${infoStr}`);
  }
}
