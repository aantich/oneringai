/**
 * ExternalToolManager - Manages external tools that require API connectors
 *
 * This manager handles tools that depend on external services:
 * - Search tools (web_search) - Serper
 * - Scrape tools (web_scrape) - ZenRows
 * - Fetch tools (web_fetch) - No connector needed (native)
 */

import { Connector, ConnectorTools } from 'oneringai';
import type { ToolFunction } from 'oneringai';
import type {
  ExternalToolsConfig,
  ExternalProviderConfig,
  ExternalProviderType,
  ExternalToolInfo,
  SearchProvider,
  ScrapeProvider,
  IConnectorManager,
} from '../config/types.js';

// Re-export for convenience
export type { ExternalToolInfo };

export interface ConnectorRequirement {
  providerType: ExternalProviderType;
  serviceType: string;
  displayName: string;
  baseURL: string;
  envVarHint: string;
}

// Provider metadata for each external tool type
const SEARCH_PROVIDERS: Record<SearchProvider, ConnectorRequirement> = {
  serper: {
    providerType: 'search',
    serviceType: 'serper',
    displayName: 'Serper (Google Search)',
    baseURL: 'https://google.serper.dev',
    envVarHint: 'SERPER_API_KEY',
  },
};

const SCRAPE_PROVIDERS: Record<ScrapeProvider, ConnectorRequirement> = {
  zenrows: {
    providerType: 'scrape',
    serviceType: 'zenrows',
    displayName: 'ZenRows (Anti-Bot)',
    baseURL: 'https://api.zenrows.com/v1',
    envVarHint: 'ZENROWS_API_KEY',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// ExternalToolManager
// ─────────────────────────────────────────────────────────────────────────────

export class ExternalToolManager {
  private config: ExternalToolsConfig;
  private connectorManager: IConnectorManager;

  constructor(config: ExternalToolsConfig, connectorManager: IConnectorManager) {
    this.config = config;
    this.connectorManager = connectorManager;
  }

  /**
   * Update configuration
   */
  updateConfig(config: ExternalToolsConfig): void {
    this.config = config;
  }

  /**
   * Get current configuration
   */
  getConfig(): ExternalToolsConfig {
    return this.config;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Tool Info & Status
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get info about all external tools
   */
  getAllToolInfo(): ExternalToolInfo[] {
    return [
      this.getSearchToolInfo(),
      this.getScrapeToolInfo(),
      this.getFetchToolInfo(),
    ];
  }

  /**
   * Get info about search tool
   */
  getSearchToolInfo(): ExternalToolInfo {
    const providerConfig = this.config.search;
    const hasConnector = !!(providerConfig?.enabled && providerConfig.connectorName);
    const connectorName = providerConfig?.connectorName || null;
    const connectorValid = connectorName
      ? this.validateConnector(connectorName, 'search').valid
      : false;

    return {
      name: 'web_search',
      displayName: 'Web Search',
      description: 'Search the web through a Serper connector',
      providerType: 'search',
      requiresConnector: true,
      available: this.config.enabled && hasConnector && connectorValid,
      connectorName,
      supportedProviders: Object.keys(SEARCH_PROVIDERS),
    };
  }

  /**
   * Get info about scrape tool
   */
  getScrapeToolInfo(): ExternalToolInfo {
    const providerConfig = this.config.scrape;
    const hasConnector = !!(providerConfig?.enabled && providerConfig.connectorName);
    const connectorName = providerConfig?.connectorName || null;
    const connectorValid = connectorName
      ? this.validateConnector(connectorName, 'scrape').valid
      : false;

    return {
      name: 'web_scrape',
      displayName: 'Web Scrape',
      description: 'Scrape web pages with anti-bot protection via ZenRows',
      providerType: 'scrape',
      requiresConnector: true,
      available: this.config.enabled && hasConnector && connectorValid,
      connectorName,
      supportedProviders: Object.keys(SCRAPE_PROVIDERS),
    };
  }

  /**
   * Get info about fetch tool (no connector needed)
   */
  getFetchToolInfo(): ExternalToolInfo {
    return {
      name: 'web_fetch',
      displayName: 'Web Fetch',
      description: 'Fetch web page content (free, no API key needed)',
      providerType: null,
      requiresConnector: false,
      available: this.config.enabled && this.config.webFetchEnabled,
      connectorName: null,
      supportedProviders: [],
    };
  }

  /**
   * Check if a provider type is configured
   */
  isProviderConfigured(type: ExternalProviderType): boolean {
    const config = type === 'search' ? this.config.search : this.config.scrape;
    return !!config?.enabled && !!config.connectorName;
  }

  /**
   * Get connector name for a provider type
   */
  getConnectorName(type: ExternalProviderType): string | null {
    const config = type === 'search' ? this.config.search : this.config.scrape;
    return config?.enabled ? config.connectorName : null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Provider Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get available providers for a type
   */
  getProvidersForType(type: ExternalProviderType): ConnectorRequirement[] {
    if (type === 'search') {
      return Object.values(SEARCH_PROVIDERS);
    } else {
      return Object.values(SCRAPE_PROVIDERS);
    }
  }

  /**
   * Get provider info by name
   */
  getProviderInfo(type: ExternalProviderType, providerName: string): ConnectorRequirement | null {
    if (type === 'search') {
      return SEARCH_PROVIDERS[providerName as SearchProvider] || null;
    } else {
      return SCRAPE_PROVIDERS[providerName as ScrapeProvider] || null;
    }
  }

  /**
   * Configure a provider
   */
  configureProvider(type: ExternalProviderType, connectorName: string): ExternalProviderConfig {
    return {
      connectorName,
      enabled: true,
    };
  }

  /**
   * Disable a provider
   */
  disableProvider(type: ExternalProviderType): ExternalProviderConfig | null {
    const current = type === 'search' ? this.config.search : this.config.scrape;
    if (!current) return null;
    return {
      ...current,
      enabled: false,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Connector Validation
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check if a connector exists and is valid for a provider type
   */
  validateConnector(connectorName: string, type: ExternalProviderType): { valid: boolean; error?: string } {
    // Check if connector exists
    const connector = this.connectorManager.get(connectorName);
    if (!connector) {
      return { valid: false, error: `Connector '${connectorName}' not found` };
    }

    // Check if connector is registered with the library
    if (!this.connectorManager.isRegistered(connectorName)) {
      return { valid: false, error: `Connector '${connectorName}' is not registered` };
    }

    // Check if it's registered in the global Connector registry
    if (!Connector.has(connectorName)) {
      return { valid: false, error: `Connector '${connectorName}' is not active` };
    }

    const expectedServiceTypes = this.getProvidersForType(type).map((provider) => provider.serviceType);
    const actualServiceType = connector.serviceType || connector.vendor.toLowerCase();
    if (!expectedServiceTypes.includes(actualServiceType)) {
      return {
        valid: false,
        error: `Connector '${connectorName}' is '${actualServiceType}', expected ${expectedServiceTypes.join(' or ')}`,
      };
    }

    return { valid: true };
  }

  /**
   * Get connectors that are suitable for a provider type
   */
  getSuitableConnectors(type: ExternalProviderType): string[] {
    const providers = type === 'search' ? SEARCH_PROVIDERS : SCRAPE_PROVIDERS;
    const serviceTypes = Object.values(providers).map((provider) => provider.serviceType);

    // Find connectors with matching service types
    const allConnectors = this.connectorManager.list();
    const suitable: string[] = [];

    for (const connector of allConnectors) {
      const serviceType = connector.serviceType || connector.vendor.toLowerCase();
      if (this.connectorManager.isRegistered(connector.name) && serviceTypes.includes(serviceType)) {
        suitable.push(connector.name);
      }
    }

    return suitable;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Tool Creation
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a configured version of the web_search tool
   */
  createSearchTool(): ToolFunction | null {
    if (!this.config.enabled) {
      return null;
    }
    if (!this.config.search?.enabled) {
      return null;
    }
    if (!this.config.search.connectorName) {
      return null;
    }

    const connectorName = this.config.search.connectorName;
    const validation = this.validateConnector(connectorName, 'search');
    if (!validation.valid) return null;
    return this.getConnectorTool(connectorName, '_web_search', 'web_search');
  }

  /**
   * Create a configured version of the web_scrape tool
   */
  createScrapeTool(): ToolFunction | null {
    if (!this.config.enabled) return null;
    if (!this.config.scrape?.enabled) return null;
    if (!this.config.scrape.connectorName) return null;

    const connectorName = this.config.scrape.connectorName;
    const validation = this.validateConnector(connectorName, 'scrape');
    if (!validation.valid) return null;
    return this.getConnectorTool(connectorName, '_web_scrape', 'web_scrape');
  }

  /**
   * Get the web_fetch tool if enabled
   */
  getFetchTool(baseTool: ToolFunction): ToolFunction | null {
    if (!this.config.enabled) return null;
    if (!this.config.webFetchEnabled) return null;
    return baseTool;
  }

  /**
   * Resolve the service-specific tool produced by ConnectorTools and expose a
   * stable AMOS command name. The execute closure remains bound to the selected
   * Serper or ZenRows connector.
   */
  private getConnectorTool(
    connectorName: string,
    toolSuffix: '_web_search' | '_web_scrape',
    publicName: 'web_search' | 'web_scrape',
  ): ToolFunction | null {
    const connectorTool = ConnectorTools.for(connectorName)
      .find((tool) => tool.definition.function.name.endsWith(toolSuffix));
    if (!connectorTool) return null;

    return {
      ...connectorTool,
      definition: {
        ...connectorTool.definition,
        function: {
          ...connectorTool.definition.function,
          name: publicName,
        },
      },
    };
  }
}

// Export provider metadata for external use
export { SEARCH_PROVIDERS, SCRAPE_PROVIDERS };
