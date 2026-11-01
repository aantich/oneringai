/**
 * ConnectorManager - Runtime connector management with filesystem persistence
 *
 * Handles loading, saving, and registering connectors with the Connector registry.
 */

import { readFile, writeFile, readdir, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Connector, ConnectorTools, Vendor } from 'oneringai';
import type { StoredConnectorConfig, IConnectorManager } from '../config/types.js';

export class ConnectorManager implements IConnectorManager {
  private connectors: Map<string, StoredConnectorConfig> = new Map();
  private registeredConnectors: Set<string> = new Set();
  private dataDir: string;

  constructor(dataDir: string = './data/connectors') {
    this.dataDir = dataDir;
  }

  /**
   * Initialize - load all connectors from disk
   */
  async initialize(): Promise<void> {
    this.connectors.clear();
    // Ensure directory exists
    if (!existsSync(this.dataDir)) {
      await mkdir(this.dataDir, { recursive: true });
      return;
    }

    // Load all connector files
    const files = await readdir(this.dataDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const content = await readFile(join(this.dataDir, file), 'utf-8');
        const config = JSON.parse(content) as StoredConnectorConfig;
        this.validateConfig(config);
        if (this.connectors.has(config.name)) {
          throw new Error(`Duplicate connector name '${config.name}'`);
        }
        this.connectors.set(config.name, config);
      } catch (error) {
        console.error(`Failed to load connector ${file}:`, error);
      }
    }
  }

  /**
   * List all connectors
   */
  list(): StoredConnectorConfig[] {
    return Array.from(this.connectors.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get a connector by name
   */
  get(name: string): StoredConnectorConfig | null {
    return this.connectors.get(name) || null;
  }

  /**
   * Add a new connector
   */
  async add(config: StoredConnectorConfig): Promise<void> {
    this.validateConfig(config);
    // Validate
    if (this.connectors.has(config.name)) {
      throw new Error(`Connector "${config.name}" already exists`);
    }

    // Save to memory
    this.connectors.set(config.name, config);
    try {
      await this.saveConnector(config);
    } catch (error) {
      this.connectors.delete(config.name);
      throw error;
    }
  }

  /**
   * Update an existing connector
   */
  async update(name: string, updates: Partial<StoredConnectorConfig>): Promise<void> {
    const existing = this.connectors.get(name);
    if (!existing) {
      throw new Error(`Connector "${name}" not found`);
    }

    const updated: StoredConnectorConfig = {
      ...existing,
      ...updates,
      name, // Name cannot change
      updatedAt: Date.now(),
    };

    this.validateConfig(updated);
    this.connectors.set(name, updated);
    try {
      await this.saveConnector(updated);
    } catch (error) {
      this.connectors.set(name, existing);
      throw error;
    }

    // If registered, re-register with new config
    if (this.registeredConnectors.has(name)) {
      this.unregisterConnector(name);
      this.registerConnector(name);
    }
  }

  /**
   * Delete a connector
   */
  async delete(name: string): Promise<void> {
    if (!this.connectors.has(name)) {
      throw new Error(`Connector "${name}" not found`);
    }

    // Unregister if registered
    if (this.registeredConnectors.has(name)) {
      this.unregisterConnector(name);
    }

    // Remove from memory
    this.connectors.delete(name);

    // Remove from disk
    const filePath = join(this.dataDir, `${name}.json`);
    if (existsSync(filePath)) {
      await unlink(filePath);
    }
  }

  /**
   * Register a connector with the Connector registry
   */
  registerConnector(name: string): void {
    const config = this.connectors.get(name);
    if (!config) {
      throw new Error(`Connector "${name}" not found`);
    }

    if (this.registeredConnectors.has(name)) {
      return; // Already registered
    }
    if (Connector.has(name)) {
      this.registeredConnectors.add(name);
      return;
    }

    // Map vendor string to Vendor enum
    const vendorMap: Record<string, string> = {
      openai: Vendor.OpenAI,
      anthropic: Vendor.Anthropic,
      google: Vendor.Google,
      'google-vertex': Vendor.GoogleVertex,
      groq: Vendor.Groq,
      together: Vendor.Together,
      grok: Vendor.Grok,
      deepseek: Vendor.DeepSeek,
      mistral: Vendor.Mistral,
      perplexity: Vendor.Perplexity,
      ollama: Vendor.Ollama,
      custom: Vendor.Custom,
    };

    // Service types for external APIs (search, scrape, etc.)
    const serviceTypeValues = [
      'serper',
      'zenrows',
    ];

    // Determine vendor and serviceType
    const vendorLower = config.vendor.toLowerCase();
    let vendor: string;
    let serviceType: string | undefined = config.serviceType;

    if (vendorMap[vendorLower]) {
      // Known LLM vendor
      vendor = vendorMap[vendorLower];
    } else if (serviceTypeValues.includes(vendorLower)) {
      // Vendor is actually a serviceType (backward compatibility)
      vendor = Vendor.Custom;
      serviceType = serviceType || vendorLower;
    } else {
      // Unknown vendor, treat as custom
      vendor = Vendor.Custom;
    }

    // Header configuration for different search/scrape providers
    const providerHeaders: Record<string, { headerName: string; headerPrefix: string }> = {
      serper: { headerName: 'X-API-KEY', headerPrefix: '' },
      zenrows: { headerName: 'Authorization', headerPrefix: 'Bearer' },
    };

    // Build auth config based on type
    let auth: { type: 'api_key'; apiKey: string; headerName?: string; headerPrefix?: string } | {
      type: 'oauth';
      flow: 'authorization_code' | 'client_credentials' | 'jwt_bearer';
      clientId: string;
      clientSecret?: string;
      tokenUrl: string;
      authorizationUrl?: string;
      scope?: string;
    };

    if (config.auth.type === 'api_key' && config.auth.apiKey) {
      // Get header config from stored config, or use provider defaults
      const headerConfig = serviceType ? providerHeaders[serviceType] : undefined;
      auth = {
        type: 'api_key',
        apiKey: config.auth.apiKey,
        headerName: config.auth.headerName || headerConfig?.headerName,
        headerPrefix: config.auth.headerPrefix ?? headerConfig?.headerPrefix,
      };
    } else if (config.auth.type === 'oauth') {
      auth = {
        type: 'oauth',
        flow: 'client_credentials', // Default flow
        clientId: config.auth.clientId || '',
        clientSecret: config.auth.clientSecret,
        tokenUrl: config.auth.tokenUrl || '',
        authorizationUrl: config.auth.authorizationUrl,
        scope: config.auth.scope,
      };
    } else {
      throw new Error(`Unsupported auth type: ${config.auth.type}`);
    }

    // Register with Connector
    Connector.create({
      name: config.name,
      vendor: vendor as typeof Vendor[keyof typeof Vendor],
      auth,
      baseURL: config.baseURL,
      options: config.options,
      serviceType, // Pass serviceType for search/scrape providers
    });

    this.registeredConnectors.add(name);
  }

  /**
   * Unregister a connector
   */
  unregisterConnector(name: string): void {
    ConnectorTools.invalidateCache(name);
    Connector.remove(name);
    this.registeredConnectors.delete(name);
  }

  /**
   * Check if a connector is registered
   */
  isRegistered(name: string): boolean {
    // Check both our tracking and the actual Connector registry
    return this.registeredConnectors.has(name) || Connector.has(name);
  }

  /**
   * Get all connectors for a vendor
   */
  getVendorConnectors(vendor: string): StoredConnectorConfig[] {
    return this.list().filter(
      (c) => c.vendor.toLowerCase() === vendor.toLowerCase()
    );
  }

  /**
   * Get available models for a connector
   */
  getModelsForConnector(name: string): string[] {
    const config = this.connectors.get(name);
    return config?.models || [];
  }

  /**
   * Save a connector to disk
   */
  private async saveConnector(config: StoredConnectorConfig): Promise<void> {
    // Ensure directory exists
    if (!existsSync(this.dataDir)) {
      await mkdir(this.dataDir, { recursive: true });
    }

    const filePath = join(this.dataDir, `${config.name}.json`);
    await writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
  }

  private validateConfig(config: StoredConnectorConfig): void {
    if (!config || typeof config !== 'object') {
      throw new Error('Connector configuration must be an object');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(config.name)) {
      throw new Error('Connector name can only contain letters, numbers, hyphens, and underscores');
    }
    if (!config.vendor || typeof config.vendor !== 'string') {
      throw new Error(`Connector '${config.name}' must declare a vendor or service type`);
    }
    if (!config.auth || !['api_key', 'oauth'].includes(config.auth.type)) {
      throw new Error(`Connector '${config.name}' has an unsupported auth type`);
    }
    if (config.auth.type === 'api_key' && !config.auth.apiKey?.trim()) {
      throw new Error(`Connector '${config.name}' requires an API key`);
    }
    if (config.auth.type === 'oauth' && (!config.auth.clientId?.trim() || !config.auth.tokenUrl?.trim())) {
      throw new Error(`Connector '${config.name}' OAuth requires clientId and tokenUrl`);
    }
  }
}
