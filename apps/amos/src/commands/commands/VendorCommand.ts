/**
 * VendorCommand - Switch or list vendors at runtime
 */

import { BaseCommand } from '../BaseCommand.js';
import type { CommandContext, CommandResult } from '../../config/types.js';
import { Vendor, getModelsByVendor, getVendorPresentation, type ILLMDescription } from '@everworker/oneringai';

export class VendorCommand extends BaseCommand {
  readonly name = 'vendor';
  readonly aliases = ['v'];
  readonly description = 'Switch vendor or list available vendors';
  readonly usage = '/vendor [name|list|info]';

  get detailedHelp(): string {
    return `
/vendor - Switch Vendor or List Available Vendors

View available AI vendors or switch to a different vendor.
Requires a configured connector for the target vendor.

USAGE:
  /vendor             List all available vendors
  /vendor list        Same as above
  /vendor info        Show detailed info about current vendor
  /vendor <name>      Switch to specified vendor

SUPPORTED VENDORS:
  openai, anthropic, google, google-vertex, groq,
  together, grok, deepseek, mistral, perplexity, ollama

EXAMPLES:
  /vendor                 List vendors with connector status
  /vendor anthropic       Switch to Anthropic
  /vendor info            Show current vendor details

ALIASES:
  /v
`;
  }

  // Existing AMOS labels compose over the shared presentation catalog.
  private vendorNames: Record<string, string> = {
    [Vendor.Google]: 'Google AI',
    [Vendor.GoogleVertex]: 'Google Vertex AI',
    [Vendor.Grok]: 'xAI Grok',
    [Vendor.Mistral]: 'Mistral AI',
    [Vendor.Ollama]: 'Ollama (Local)',
  };

  /**
   * Get vendor info dynamically from MODEL_REGISTRY
   */
  private getVendorInfo(vendorId: string): { name: string; defaultModel: string; description: string } {
    const name = Object.hasOwn(this.vendorNames, vendorId)
      ? this.vendorNames[vendorId]! : getVendorPresentation(vendorId)?.displayName ?? vendorId;
    const models = getModelsByVendor(vendorId as any);

    if (models.length === 0) {
      // Vendor has no models in registry, use fallback
      return {
        name,
        defaultModel: 'default',
        description: 'No models registered',
      };
    }

    // Select default model: prefer most capable (Opus/Pro) or latest
    const defaultModel = this.selectDefaultModel(models);

    // Generate description from available models
    const modelNames = models.slice(0, 3).map((m) => this.getShortModelName(m.name));
    const description =
      models.length <= 3
        ? modelNames.join(', ')
        : `${modelNames.join(', ')} + ${models.length - 3} more`;

    return { name, defaultModel, description };
  }

  /**
   * Select the best default model for a vendor
   */
  private selectDefaultModel(models: ILLMDescription[]): string {
    // Honor registry recommendations before applying vendor-name heuristics.
    const preferred = models.find((model) => model.preferred && model.isActive);
    if (preferred) return preferred.name;

    // Prefer: Opus > Pro > Sonnet > largest context > first
    const opus = models.find((m) => m.name.toLowerCase().includes('opus'));
    if (opus) return opus.name;

    const pro = models.find((m) => m.name.toLowerCase().includes('pro') && !m.name.includes('preview'));
    if (pro) return pro.name;

    const sonnet = models.find((m) => m.name.toLowerCase().includes('sonnet'));
    if (sonnet) return sonnet.name;

    // Sort by context window size (descending) and take first
    const sorted = [...models].sort((a, b) => (b.features.input.tokens ?? 0) - (a.features.input.tokens ?? 0));
    return sorted[0]?.name || models[0].name;
  }

  /**
   * Get a short, friendly model name for display
   */
  private getShortModelName(fullName: string): string {
    // Extract key parts: GPT-5.2, Claude Opus 4.5, Gemini 3 Flash, etc.
    if (fullName.startsWith('gpt-6')) return fullName.toUpperCase();
    if (fullName.startsWith('gpt-5')) return fullName.split('-').slice(0, 2).join('-').toUpperCase();
    if (fullName.startsWith('gpt-4')) return fullName.split('-').slice(0, 2).join('-').toUpperCase();
    if (fullName.startsWith('claude')) {
      const parts = fullName.split('-');
      return `Claude ${parts[1]?.toUpperCase() || ''} ${parts[2] || ''}`.trim();
    }
    if (fullName.startsWith('gemini')) {
      return fullName
        .split('-')
        .slice(0, 3)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(' ');
    }
    return fullName;
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const { args, app } = context;

    if (args.length === 0 || args[0] === 'list') {
      return this.listVendors(context);
    }

    if (args[0] === 'info') {
      return this.showVendorInfo(context);
    }

    // Switch vendor
    const vendorName = args[0].toLowerCase();
    return this.switchVendor(context, vendorName);
  }

  private async listVendors(context: CommandContext): Promise<CommandResult> {
    const { app } = context;
    const config = app.getConfig();
    const currentVendor = config.activeVendor || config.defaults.vendor;
    const connectorManager = app.getConnectorManager();

    const lines = [
      'Available Vendors:',
      '',
    ];

    // Get all vendor IDs from Vendor enum
    const vendorIds = Object.values(Vendor) as string[];

    for (const vendorId of vendorIds) {
      const info = this.getVendorInfo(vendorId);
      const marker = vendorId === currentVendor ? '→ ' : '  ';
      const connectors = connectorManager.getVendorConnectors(vendorId);
      const connectorStr = connectors.length > 0
        ? ` (${connectors.length} connector${connectors.length > 1 ? 's' : ''})`
        : ' (no connectors)';

      lines.push(`${marker}${vendorId.padEnd(15)} ${info.name}${connectorStr}`);
      lines.push(`    ${info.description}`);
    }

    lines.push('');
    lines.push('Usage: /vendor <name> to switch');
    lines.push('Note: You need a connector for the vendor to use it.');

    return this.success(lines.join('\n'));
  }

  private async showVendorInfo(context: CommandContext): Promise<CommandResult> {
    const { app } = context;
    const config = app.getConfig();
    const currentVendor = config.activeVendor || config.defaults.vendor;
    const connectorManager = app.getConnectorManager();

    const info = this.getVendorInfo(currentVendor);
    const connectors = connectorManager.getVendorConnectors(currentVendor);
    const connectorList = connectors.length > 0
      ? connectors.map((c) => `  • ${c.name}`).join('\n')
      : '  (none configured)';

    // Get model count
    const models = getModelsByVendor(currentVendor as any);
    const modelCount = models.length > 0 ? `${models.length} model${models.length > 1 ? 's' : ''}` : 'No models';

    const output = `
Vendor: ${info.name} (${currentVendor})

Available Models: ${modelCount}
  ${info.description}
Recommended Default: ${info.defaultModel}

Configured Connectors:
${connectorList}

Current Settings:
  Active Model: ${config.activeModel || config.defaults.model}
  Active Connector: ${config.activeConnector || '(none)'}

Tip: Use /model list to see all available models for this vendor
`;

    return this.success(output);
  }

  private async switchVendor(context: CommandContext, vendorName: string): Promise<CommandResult> {
    const { app } = context;
    const connectorManager = app.getConnectorManager();

    // Validate vendor
    const vendorValues = Object.values(Vendor) as string[];
    if (!vendorValues.includes(vendorName)) {
      const suggestions = vendorValues
        .filter((v) => v.includes(vendorName))
        .slice(0, 3);

      let message = `Unknown vendor: ${vendorName}`;
      if (suggestions.length > 0) {
        message += `\nDid you mean: ${suggestions.join(', ')}?`;
      }
      message += '\nType /vendor list to see all vendors.';

      return this.error(message);
    }

    // Check for connectors
    const connectors = connectorManager.getVendorConnectors(vendorName);
    if (connectors.length === 0) {
      return this.error(
        `No connectors configured for ${vendorName}.\n` +
        `Use /connector add or /connector generate to create one.`
      );
    }

    // Get default model for vendor from MODEL_REGISTRY
    const vendorInfo = this.getVendorInfo(vendorName);
    const connectorModels = connectorManager.getModelsForConnector(connectors[0].name);
    const defaultModel = connectorModels[0] || vendorInfo.defaultModel;
    if (defaultModel === 'default') {
      return this.error(
        `No default model is registered for ${vendorName}. ` +
        `Add a models list to connector '${connectors[0].name}' or switch with /model <name>.`
      );
    }

    // Update config
    app.updateConfig({
      activeVendor: vendorName,
      activeModel: defaultModel,
      activeConnector: connectors[0].name, // Use first connector
    });

    // Recreate agent with new vendor
    await app.createAgent();
    await app.saveConfig();

    return this.success(
      `Switched to vendor: ${vendorName}\n` +
      `Using connector: ${connectors[0].name}\n` +
      `Default model: ${defaultModel}`
    );
  }
}
