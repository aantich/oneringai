/**
 * ConnectorCommand - Manage connectors at runtime
 *
 * Supports: add, edit, delete, list, generate, use, info
 */

import { BaseCommand } from '../BaseCommand.js';
import type { CommandContext, CommandResult, StoredConnectorConfig, ConnectorAuth } from '../../config/types.js';
import { Vendor } from 'oneringai';

export class ConnectorCommand extends BaseCommand {
  readonly name = 'connector';
  readonly aliases = ['conn', 'c'];
  readonly description = 'Manage connectors (add, edit, delete, list, generate)';
  readonly usage = '/connector <list|add|edit|delete|generate|use|info> [args]';

  get detailedHelp(): string {
    return `
/connector - Manage API Connectors

Connectors store authentication credentials for AI vendors.
Multiple connectors per vendor are supported (e.g., openai-main, openai-backup).

USAGE:
  /connector              List all connectors
  /connector list         Same as above
  /connector add          Interactive connector creation
  /connector edit <name>  Edit an existing connector
  /connector delete <name> Delete a connector
  /connector generate     AI-assisted connector generation
  /connector use <name>   Switch to a connector
  /connector info [name]  Show connector details

EXAMPLES:
  /connector add              Add a new connector interactively
  /connector use openai-main  Switch to openai-main connector
  /connector info             Show current connector details
  /connector delete old-key   Delete the old-key connector

ALIASES:
  /conn, /c
`;
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const { subcommand, subArgs } = this.parseSubcommand(context.args);

    switch (subcommand) {
      case 'list':
      case 'ls':
      case null:
        return this.listConnectors(context);

      case 'add':
      case 'new':
      case 'create':
        return this.addConnector(context);

      case 'edit':
      case 'update':
        return this.editConnector(context, subArgs[0]);

      case 'delete':
      case 'rm':
      case 'remove':
        return this.deleteConnector(context, subArgs[0]);

      case 'generate':
      case 'gen':
        return this.generateConnector(context);

      case 'use':
      case 'switch':
        return this.useConnector(context, subArgs[0]);

      case 'info':
      case 'show':
        return this.showConnectorInfo(context, subArgs[0]);

      default:
        return this.error(
          `Unknown subcommand: ${subcommand}\n` +
          'Available: list, add, edit, delete, generate, use, info'
        );
    }
  }

  private async listConnectors(context: CommandContext): Promise<CommandResult> {
    const { app } = context;
    const connectorManager = app.getConnectorManager();
    const config = app.getConfig();
    const connectors = connectorManager.list();

    if (connectors.length === 0) {
      return this.success(
        'No connectors configured.\n' +
        'Use /connector add or /connector generate to create one.'
      );
    }

    const lines = ['Configured Connectors:', ''];

    // Group by vendor
    const byVendor = new Map<string, StoredConnectorConfig[]>();
    for (const conn of connectors) {
      const list = byVendor.get(conn.vendor) || [];
      list.push(conn);
      byVendor.set(conn.vendor, list);
    }

    for (const [vendor, vendorConnectors] of byVendor) {
      lines.push(`${vendor}:`);
      for (const conn of vendorConnectors) {
        const active = conn.name === config.activeConnector ? '→ ' : '  ';
        const registered = connectorManager.isRegistered(conn.name) ? '✓' : '○';
        lines.push(`${active}${registered} ${conn.name}`);
        if (conn.baseURL) {
          lines.push(`      URL: ${conn.baseURL}`);
        }
      }
      lines.push('');
    }

    lines.push('Legend: → active, ✓ registered, ○ not registered');
    lines.push('Use /connector use <name> to switch');

    return this.success(lines.join('\n'));
  }

  private async addConnector(context: CommandContext): Promise<CommandResult> {
    const { app } = context;

    app.print('\n=== Add New Connector ===\n');

    // Get connector name
    const name = await app.prompt('Connector name (e.g., openai-main): ');
    if (!name.trim()) {
      return this.error('Connector name is required.');
    }
    const connectorName = name.trim();

    // Check if exists
    const connectorManager = app.getConnectorManager();
    if (connectorManager.get(connectorName)) {
      return this.error(`Connector "${connectorName}" already exists. Use /connector edit ${connectorName} to modify.`);
    }

    // Get vendor
    const vendorOptions = Object.values(Vendor) as string[];
    app.print('\nAvailable vendors:');
    vendorOptions.forEach((v, i) => app.print(`  ${i + 1}. ${v}`));
    const vendorInput = await app.prompt('\nSelect vendor (name or number): ');

    let vendor: string;
    const vendorNum = parseInt(vendorInput);
    if (!isNaN(vendorNum) && vendorNum >= 1 && vendorNum <= vendorOptions.length) {
      vendor = vendorOptions[vendorNum - 1];
    } else if (vendorOptions.includes(vendorInput.toLowerCase())) {
      vendor = vendorInput.toLowerCase();
    } else {
      return this.error(`Invalid vendor: ${vendorInput}`);
    }

    // Get auth type
    const authType = await app.select<'api_key' | 'oauth'>('Authentication type:', ['api_key', 'oauth']);

    let auth: ConnectorAuth;

    if (authType === 'api_key') {
      const apiKey = await app.prompt('API Key: ');
      if (!apiKey.trim()) {
        return this.error('API key is required.');
      }
      auth = { type: 'api_key', apiKey: apiKey.trim() };
    } else {
      // OAuth client-credentials flow (interactive authorization-code login is
      // outside the scope of this terminal app).
      app.print('OAuth in AMOS uses the client_credentials flow.');
      const clientId = await app.prompt('Client ID: ');
      const clientSecret = await app.prompt('Client Secret: ');
      const tokenUrl = await app.prompt('Token URL: ');
      const scope = await app.prompt('Scope (optional): ');

      auth = {
        type: 'oauth',
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        tokenUrl: tokenUrl.trim(),
        scope: scope.trim() || undefined,
      };
    }

    // Optional base URL
    const baseURL = await app.prompt('Custom Base URL (optional, press Enter to skip): ');

    // Create connector config
    const connectorConfig: StoredConnectorConfig = {
      name: connectorName,
      vendor,
      auth,
      baseURL: baseURL.trim() || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Save
    await connectorManager.add(connectorConfig);

    // Offer to use immediately
    const useNow = await app.confirm('Use this connector now?');
    if (useNow) {
      connectorManager.registerConnector(connectorName);
      app.updateConfig({ activeConnector: connectorName, activeVendor: vendor });
      await app.createAgent();
      await app.saveConfig();
      return this.success(`Connector "${connectorName}" created and activated.`);
    }

    return this.success(`Connector "${connectorName}" created. Use /connector use ${connectorName} to activate.`);
  }

  private async editConnector(context: CommandContext, name?: string): Promise<CommandResult> {
    const { app } = context;

    if (!name) {
      return this.error('Connector name required. Usage: /connector edit <name>');
    }

    const connectorManager = app.getConnectorManager();
    const existing = connectorManager.get(name);

    if (!existing) {
      return this.error(`Connector "${name}" not found.`);
    }

    app.print(`\n=== Edit Connector: ${name} ===\n`);
    app.print('Press Enter to keep current value.\n');

    const updated: StoredConnectorConfig = {
      ...existing,
      auth: { ...existing.auth },
    };

    // Edit API key (for api_key auth)
    if (updated.auth.type === 'api_key') {
      const newKey = await app.prompt(`API Key [****${updated.auth.apiKey?.slice(-4) || ''}]: `);
      if (newKey.trim()) {
        updated.auth.apiKey = newKey.trim();
      }
    }

    // Edit base URL
    const currentURL = updated.baseURL || '(none)';
    const newURL = await app.prompt(`Base URL [${currentURL}]: `);
    if (newURL.trim()) {
      updated.baseURL = newURL.trim() === 'none' ? undefined : newURL.trim();
    }

    updated.updatedAt = Date.now();

    await connectorManager.update(name, updated);

    // Re-register if active
    const config = app.getConfig();
    if (config.activeConnector === name) {
      await app.createAgent();
    }

    return this.success(`Connector "${name}" updated.`);
  }

  private async deleteConnector(context: CommandContext, name?: string): Promise<CommandResult> {
    const { app } = context;

    if (!name) {
      return this.error('Connector name required. Usage: /connector delete <name>');
    }

    const connectorManager = app.getConnectorManager();
    const existing = connectorManager.get(name);

    if (!existing) {
      return this.error(`Connector "${name}" not found.`);
    }

    const confirm = await app.confirm(`Delete connector "${name}"? This cannot be undone.`);
    if (!confirm) {
      return this.success('Cancelled.');
    }

    // Check if active
    const config = app.getConfig();
    if (config.activeConnector === name) {
      app.destroyAgent();
      app.updateConfig({ activeConnector: null });
    }

    await connectorManager.delete(name);

    const externalTools = { ...config.externalTools };
    let externalChanged = false;
    if (externalTools.search?.connectorName === name) {
      externalTools.search = { ...externalTools.search, enabled: false };
      externalChanged = true;
    }
    if (externalTools.scrape?.connectorName === name) {
      externalTools.scrape = { ...externalTools.scrape, enabled: false };
      externalChanged = true;
    }
    if (externalChanged) {
      app.updateConfig({ externalTools });
      const toolLoader = app.getToolLoader();
      toolLoader.setConfig(app.getConfig());
      await toolLoader.reloadTools();
      toolLoader.applyConfig(
        app.getConfig().tools.enabledTools,
        app.getConfig().tools.disabledTools,
      );
      app.getAgent()?.updateTools(toolLoader.getEnabledTools());
    }
    await app.saveConfig();

    return this.success(`Connector "${name}" deleted.`);
  }

  private async generateConnector(context: CommandContext): Promise<CommandResult> {
    const { app } = context;

    app.print('\n=== AI-Assisted Connector Generator ===\n');
    app.print('Describe the API you want to connect to, and I will help generate the configuration.\n');

    // Check if we have an active agent
    const agent = app.getAgent();
    if (!agent) {
      return this.error(
        'No active agent to generate connector.\n' +
        'First configure a connector manually with /connector add,\n' +
        'then you can use /connector generate for additional connectors.'
      );
    }

    const description = await app.prompt('Describe the API (e.g., "OpenAI API with my personal key"): ');

    if (!description.trim()) {
      return this.error('Description is required.');
    }

    app.print('\nGenerating configuration...\n');

    try {
      const response = await agent.run(`
You are helping configure an API connector. Based on the user's description, generate a JSON configuration.

User's description: "${description}"

Generate a JSON object with these fields:
- name: A short identifier (lowercase, hyphens ok)
- vendor: One of: openai, anthropic, google, google-vertex, groq, together, grok, deepseek, mistral, perplexity, ollama, custom
- auth.type: "api_key" (most common)
- baseURL: Only if using a custom endpoint
- notes: Any helpful notes for the user

Respond with ONLY the JSON object, no explanation.
`);

      const text = response.text;

      // Try to parse JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        app.print('AI Response:\n' + text);
        return this.error('Could not parse configuration. Please try /connector add instead.');
      }

      const generated = JSON.parse(jsonMatch[0]);

      app.print('\nGenerated Configuration:');
      app.print(JSON.stringify(generated, null, 2));

      const useConfig = await app.confirm('\nUse this configuration?');
      if (!useConfig) {
        return this.success('Cancelled. Use /connector add for manual configuration.');
      }

      // Get API key
      const apiKey = await app.prompt('Enter API Key: ');
      if (!apiKey.trim()) {
        return this.error('API key is required.');
      }

      // Create connector
      const connectorConfig: StoredConnectorConfig = {
        name: generated.name || 'generated-connector',
        vendor: generated.vendor || 'custom',
        auth: { type: 'api_key', apiKey: apiKey.trim() },
        baseURL: generated.baseURL,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const connectorManager = app.getConnectorManager();
      await connectorManager.add(connectorConfig);

      return this.success(`Connector "${connectorConfig.name}" created. Use /connector use ${connectorConfig.name} to activate.`);
    } catch (error) {
      return this.error(`Generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async useConnector(context: CommandContext, name?: string): Promise<CommandResult> {
    const { app } = context;

    if (!name) {
      return this.error('Connector name required. Usage: /connector use <name>');
    }

    const connectorManager = app.getConnectorManager();
    const connector = connectorManager.get(name);

    if (!connector) {
      return this.error(`Connector "${name}" not found. Use /connector list to see available.`);
    }

    // Register if not already
    if (!connectorManager.isRegistered(name)) {
      connectorManager.registerConnector(name);
    }

    // Update config
    app.updateConfig({
      activeConnector: name,
      activeVendor: connector.vendor,
    });

    // Recreate agent
    await app.createAgent();
    await app.saveConfig();

    return this.success(`Now using connector: ${name} (${connector.vendor})`);
  }

  private async showConnectorInfo(context: CommandContext, name?: string): Promise<CommandResult> {
    const { app } = context;
    const config = app.getConfig();
    const connectorManager = app.getConnectorManager();

    // Use active connector if no name provided
    const connectorName = name || config.activeConnector;
    if (!connectorName) {
      return this.error('No connector specified and no active connector.');
    }

    const connector = connectorManager.get(connectorName);
    if (!connector) {
      return this.error(`Connector "${connectorName}" not found.`);
    }

    const isActive = connectorName === config.activeConnector;
    const isRegistered = connectorManager.isRegistered(connectorName);

    const maskedKey = connector.auth.apiKey
      ? '****' + connector.auth.apiKey.slice(-4)
      : '(not set)';

    const info = `
Connector: ${connector.name}
Vendor: ${connector.vendor}

Authentication:
  Type: ${connector.auth.type}
  ${connector.auth.type === 'api_key' ? `API Key: ${maskedKey}` : ''}
  ${connector.baseURL ? `Base URL: ${connector.baseURL}` : ''}

Status:
  Active: ${isActive ? 'Yes' : 'No'}
  Registered: ${isRegistered ? 'Yes' : 'No'}

Created: ${new Date(connector.createdAt).toLocaleString()}
Updated: ${new Date(connector.updatedAt).toLocaleString()}
`;

    return this.success(info);
  }
}
