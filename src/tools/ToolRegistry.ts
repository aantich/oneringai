/**
 * ToolRegistry - Unified registry for all tools (built-in + connector-generated)
 *
 * This class provides a single API for discovering all available tools:
 * - Built-in tools from registry.generated.ts (filesystem, shell, web, etc.)
 * - Connector tools generated at runtime by ConnectorTools
 *
 * @example
 * ```typescript
 * import { ToolRegistry } from 'oneringai';
 *
 * // Get all tools (built-in + connector)
 * const allTools = ToolRegistry.getAllTools();
 *
 * // Get only connector tools
 * const connectorTools = ToolRegistry.getAllConnectorTools();
 *
 * // Get tools for a specific connector
 * const githubTools = ToolRegistry.getConnectorTools('github');
 * ```
 */

import type { ToolFunction } from '../domain/entities/Tool.js';
import { toolRegistry, type ToolRegistryEntry, type ToolCategory } from './registry.generated.js';
import { ConnectorTools } from './connector/ConnectorTools.js';
import { Connector } from '../core/Connector.js';
import { getServiceInfo } from '../domain/entities/Services.js';
import { getVendorInfo } from '../connectors/vendors/helpers.js';

/**
 * Extended registry entry for connector-generated tools
 */
export interface ConnectorToolEntry extends ToolRegistryEntry {
  /** Name of the connector that generated this tool */
  connectorName: string;
  /** Service type (e.g., 'github', 'slack') if detected */
  serviceType?: string;
}

/**
 * Unified tool registry that combines built-in and connector tools
 */
export class ToolRegistry {
  /**
   * Get built-in tools only (from registry.generated.ts)
   *
   * @returns Array of built-in tool registry entries
   */
  static getBuiltInTools(): ToolRegistryEntry[] {
    return [...toolRegistry];
  }

  /**
   * Get tools for a specific connector
   *
   * @param connectorName - Name of the connector to get tools for
   * @returns Array of connector tool entries
   *
   * @example
   * ```typescript
   * const githubTools = ToolRegistry.getConnectorTools('github');
   * ```
   */
  static getConnectorTools(connectorName: string): ConnectorToolEntry[] {
    try {
      const tools = ConnectorTools.for(connectorName);
      return tools.map((tool) => this.toRegistryEntry(tool, connectorName));
    } catch {
      // Connector may not exist or may not have tools
      return [];
    }
  }

  /**
   * Get all connector tools from all registered service connectors
   *
   * This discovers tools from all connectors that have:
   * - Explicit serviceType, OR
   * - baseURL but no vendor (external API, not AI provider)
   *
   * @returns Array of all connector tool entries
   */
  static getAllConnectorTools(): ConnectorToolEntry[] {
    const allTools: ConnectorToolEntry[] = [];
    const discovered = ConnectorTools.discoverAll();

    for (const [connectorName, tools] of discovered) {
      for (const tool of tools) {
        allTools.push(this.toRegistryEntry(tool, connectorName));
      }
    }
    return allTools;
  }

  /**
   * Get ALL tools (built-in + connector) - main API for UIs
   *
   * This is the primary method for getting a complete list of available tools.
   *
   * @returns Array of all tool registry entries (built-in and connector)
   *
   * @example
   * ```typescript
   * const allTools = ToolRegistry.getAllTools();
   * for (const tool of allTools) {
   *   console.log(`${tool.displayName}: ${tool.description}`);
   * }
   * ```
   */
  static getAllTools(): (ToolRegistryEntry | ConnectorToolEntry)[] {
    return [...this.getBuiltInTools(), ...this.getAllConnectorTools()];
  }

  /**
   * Get tools filtered by service type
   *
   * @param serviceType - Service type to filter by (e.g., 'github', 'slack')
   * @returns Array of connector tool entries for the service
   */
  static getToolsByService(serviceType: string): ConnectorToolEntry[] {
    return this.getAllConnectorTools().filter((entry) => entry.serviceType === serviceType);
  }

  /**
   * Get tools filtered by connector name
   *
   * @param connectorName - Connector name to filter by
   * @returns Array of connector tool entries for the connector
   */
  static getToolsByConnector(connectorName: string): ConnectorToolEntry[] {
    return this.getAllConnectorTools().filter((entry) => entry.connectorName === connectorName);
  }

  /**
   * Check if a tool entry is a connector tool
   *
   * @param entry - Tool registry entry to check
   * @returns True if the entry is a connector tool
   */
  static isConnectorTool(entry: ToolRegistryEntry | ConnectorToolEntry): entry is ConnectorToolEntry {
    return 'connectorName' in entry && typeof entry.connectorName === 'string';
  }

  /**
   * Convert a ToolFunction to a ConnectorToolEntry
   */
  private static toRegistryEntry(tool: ToolFunction, connectorName: string): ConnectorToolEntry {
    let serviceType: string | undefined;
    let displayPrefix: string | undefined;

    try {
      const connector = Connector.get(connectorName);
      serviceType = ConnectorTools.detectService(connector);
      if (connector.vendor) {
        const vendorInfo = getVendorInfo(connector.vendor);
        displayPrefix = vendorInfo?.name || connector.vendor;
      }
    } catch {
      // Connector may not exist
    }

    const serviceInfo = serviceType ? getServiceInfo(serviceType) : undefined;
    const displayContext = displayPrefix || serviceInfo?.name;
    const def = tool.definition.function;

    return {
      name: def.name,
      exportName: def.name,
      displayName: this.deriveDisplayName(def.name, displayContext, connectorName),
      category: 'connector' as ToolCategory,
      description: def.description || `API tool for ${connectorName}`,
      tool,
      safeByDefault: false,
      requiresConnector: true,
      connectorServiceTypes: serviceType ? [serviceType] : undefined,
      connectorName,
      serviceType,
    };
  }

  /**
   * Derive a human-readable display name from a tool name
   *
   * @param toolName - Full tool name (e.g., "main-openai_generate_image")
   * @param contextName - Vendor or service display name (e.g., "OpenAI")
   * @param connectorName - Connector name used as prefix (e.g., "main-openai")
   */
  private static deriveDisplayName(
    toolName: string,
    contextName?: string,
    connectorName?: string
  ): string {
    // Strip connector name prefix if present
    let baseName = toolName;
    if (connectorName && toolName.startsWith(connectorName + '_')) {
      baseName = toolName.slice(connectorName.length + 1);
    }

    // "api" → "Context API"
    if (baseName === 'api') {
      return contextName ? `${contextName} API` : toolName.replace(/_/g, ' ');
    }

    // Convert base to Title Case
    const readable = baseName
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    return contextName ? `${contextName} ${readable}` : readable;
  }
}
