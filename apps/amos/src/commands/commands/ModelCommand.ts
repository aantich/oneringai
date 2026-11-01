/**
 * ModelCommand - Switch or list models at runtime
 */

import { BaseCommand } from '../BaseCommand.js';
import type { CommandContext, CommandResult } from '../../config/types.js';
import { getModelsByVendor, getModelInfo } from 'oneringai';

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
      const marker = model.name === currentModel ? '→ ' : '  ';
      const features: string[] = [];
      if (model.features.vision) features.push('vision');
      if (model.features.reasoning) features.push('reasoning');
      if (model.features.functionCalling) features.push('tools');
      if (model.features.asyncToolCalling) features.push('async tools');
      if (model.features.midTurnSteering) features.push('steering');
      const featureStr = features.length > 0 ? ` [${features.join(', ')}]` : '';

      lines.push(`${marker}${model.name}${featureStr}`);
      lines.push(`    Context: ${((model.features.input.tokens ?? 0) / 1000).toFixed(0)}K in / ${((model.features.output.tokens ?? 0) / 1000).toFixed(0)}K out`);
    }

    lines.push('');
    lines.push('Usage: /model <model-name> to switch');

    return this.success(lines.join('\n'));
  }

  private async showModelInfo(context: CommandContext): Promise<CommandResult> {
    const { app } = context;
    const config = app.getConfig();
    const currentModel = config.activeModel || config.defaults.model;

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
  Input:  ${((features.input.tokens ?? 0) / 1000).toFixed(0)}K tokens
  Output: ${((features.output.tokens ?? 0) / 1000).toFixed(0)}K tokens

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

    // Validate model exists (either in registry or accept any)
    const modelInfo = getModelInfo(modelName);

    // Update config
    app.updateConfig({ activeModel: modelName });

    // Recreate agent with new model (model change requires agent recreation)
    try {
      await app.createAgent();
      await app.saveConfig();
    } catch (error) {
      return this.error(`Failed to switch model: ${error instanceof Error ? error.message : String(error)}`);
    }

    const infoStr = modelInfo
      ? ` (${modelInfo.provider})`
      : ' (custom model)';

    return this.success(`Switched to model: ${modelName}${infoStr}`);
  }
}
