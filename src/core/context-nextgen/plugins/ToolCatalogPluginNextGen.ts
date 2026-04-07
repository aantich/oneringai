/**
 * ToolCatalogPluginNextGen - Dynamic Tool Loading/Unloading for Agents
 *
 * When agents need 100+ tools, sending all tool definitions to the LLM wastes
 * tokens and degrades performance. This plugin provides 3 metatools that let
 * agents discover and load only the tool categories they need.
 *
 * Categories come from ToolCatalogRegistry (static global) and ConnectorTools
 * (runtime discovery). The plugin manages loaded/unloaded state via ToolManager.
 *
 * Scoping:
 * - Built-in categories are scoped by `categoryScope` (toolCategories config)
 * - Connector categories are scoped by `identities` (not by categoryScope)
 * - Plugin tools (memory_*, context_*, etc.) are always available and separate
 *
 * @example
 * ```typescript
 * const ctx = AgentContextNextGen.create({
 *   model: 'gpt-4',
 *   features: { toolCatalog: true },
 *   toolCategories: ['filesystem', 'web'],  // built-in scope only
 *   identities: [{ connector: 'github' }],  // connector scope
 *   plugins: {
 *     toolCatalog: {
 *       pinned: ['filesystem'],              // always loaded, can't unload
 *     },
 *   },
 * });
 * ```
 */

import { BasePluginNextGen } from '../BasePluginNextGen.js';
import type { ToolFunction } from '../../../domain/entities/Tool.js';
import type { AuthIdentity } from '../types.js';
import {
  ToolCatalogRegistry,
  type ToolCategoryScope,
  type ToolCategoryDefinition,
  type ConnectorCategoryInfo,
} from '../../ToolCatalogRegistry.js';
import type { ToolManager } from '../../ToolManager.js';
import { logger } from '../../../infrastructure/observability/Logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ToolCatalogPluginConfig {
  /** Scope filter for which built-in categories are visible (does NOT affect connector categories) */
  categoryScope?: ToolCategoryScope;
  /** Categories to pre-load on initialization (can be unloaded by LLM) */
  autoLoadCategories?: string[];
  /** Categories that are always loaded and cannot be unloaded by the LLM */
  pinned?: string[];
  /** Maximum loaded categories at once, excluding pinned (default: 10) */
  maxLoadedCategories?: number;
  /** Auth identities for connector category filtering */
  identities?: AuthIdentity[];
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_LOADED = 10;

// ============================================================================
// Tool Definitions
// ============================================================================

const catalogSearchDefinition = {
  type: 'function' as const,
  function: {
    name: 'tool_catalog_search',
    description: 'Search the tool catalog. No params lists categories. Use category to list tools in it, query to keyword-search, or listAll to list every tool across all categories.',
    parameters: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Keyword to search across category names, descriptions, and tool names',
        },
        category: {
          type: 'string',
          description: 'Category name to list its tools',
        },
        listAll: {
          type: 'boolean',
          description: 'List all tools across all available categories and connectors, grouped by category',
        },
      },
    },
  },
};

const catalogLoadDefinition = {
  type: 'function' as const,
  function: {
    name: 'tool_catalog_load',
    description: 'Load all tools from a category so they become available for use.',
    parameters: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'Category name to load',
        },
      },
      required: ['category'],
    },
  },
};

const catalogUnloadDefinition = {
  type: 'function' as const,
  function: {
    name: 'tool_catalog_unload',
    description: 'Unload a category to free token budget. Tools from this category will no longer be available.',
    parameters: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'Category name to unload',
        },
      },
      required: ['category'],
    },
  },
};

// ============================================================================
// Plugin
// ============================================================================

export class ToolCatalogPluginNextGen extends BasePluginNextGen {
  readonly name = 'tool_catalog';

  /** category name → array of tool names that were loaded */
  private _loadedCategories = new Map<string, string[]>();

  /** Categories that cannot be unloaded */
  private _pinnedCategories = new Set<string>();

  /** Reference to the ToolManager for registering/disabling tools */
  private _toolManager: ToolManager | null = null;

  /** Cached connector categories — discovered once in setToolManager() */
  private _connectorCategories: ConnectorCategoryInfo[] | null = null;

  /** Whether this plugin has been destroyed */
  private _destroyed = false;

  /** WeakMap cache for tool definition token estimates */
  private _toolTokenCache = new WeakMap<object, number>();

  private _config: Required<Pick<ToolCatalogPluginConfig, 'maxLoadedCategories'>> & ToolCatalogPluginConfig;

  constructor(config?: ToolCatalogPluginConfig) {
    super();
    this._config = {
      maxLoadedCategories: DEFAULT_MAX_LOADED,
      ...config,
    };
    // Populate pinned set from config
    if (this._config.pinned?.length) {
      for (const cat of this._config.pinned) {
        this._pinnedCategories.add(cat);
      }
    }
  }

  // ========================================================================
  // Plugin Interface
  // ========================================================================

  getInstructions(): string {
    return this.buildInstructions();
  }

  async getContent(): Promise<string | null> {
    const categories = this.getAllowedCategories();
    if (categories.length === 0 && this.getConnectorCategories().length === 0) return null;

    const lines: string[] = ['## Tool Catalog'];
    lines.push('');

    const loaded = Array.from(this._loadedCategories.keys());
    if (loaded.length > 0) {
      lines.push(`**Loaded:** ${loaded.join(', ')}`);
    }

    lines.push(`**Available categories:** ${categories.length + this.getConnectorCategories().length}`);

    // Brief summary of categories
    for (const cat of categories) {
      const tools = ToolCatalogRegistry.getToolsInCategory(cat.name);
      const markers = this.getCategoryMarkers(cat.name);
      lines.push(`- **${cat.displayName}** (${tools.length} tools)${markers}: ${cat.description}`);
    }

    // Add connector categories (from cache)
    for (const cc of this.getConnectorCategories()) {
      const markers = this.getCategoryMarkers(cc.name);
      lines.push(`- **${cc.displayName}** (${cc.toolCount} tools)${markers}: ${cc.description}`);
    }

    const content = lines.join('\n');
    this.updateTokenCache(this.estimator.estimateTokens(content));
    return content;
  }

  getContents(): unknown {
    return {
      loadedCategories: Array.from(this._loadedCategories.entries()).map(([name, tools]) => ({
        category: name,
        toolCount: tools.length,
        tools,
        pinned: this._pinnedCategories.has(name),
      })),
    };
  }

  getTools(): ToolFunction[] {
    const plugin = this;

    const searchTool: ToolFunction = {
      definition: catalogSearchDefinition,
      permission: { scope: 'always' as const, riskLevel: 'low' as const },
      execute: async (args: Record<string, unknown>) => {
        return plugin.executeSearch(args.query as string | undefined, args.category as string | undefined, args.listAll as boolean | undefined);
      },
    };

    const loadTool: ToolFunction = {
      definition: catalogLoadDefinition,
      permission: { scope: 'always' as const, riskLevel: 'low' as const },
      execute: async (args: Record<string, unknown>) => {
        return plugin.executeLoad(args.category as string);
      },
    };

    const unloadTool: ToolFunction = {
      definition: catalogUnloadDefinition,
      permission: { scope: 'always' as const, riskLevel: 'low' as const },
      execute: async (args: Record<string, unknown>) => {
        return plugin.executeUnload(args.category as string);
      },
    };

    return [searchTool, loadTool, unloadTool];
  }

  isCompactable(): boolean {
    // Only compactable if there are non-pinned loaded categories
    for (const category of this._loadedCategories.keys()) {
      if (!this._pinnedCategories.has(category)) return true;
    }
    return false;
  }

  async compact(targetTokensToFree: number): Promise<number> {
    if (!this._toolManager || this._loadedCategories.size === 0) return 0;

    // Sort loaded categories by least recently used, excluding pinned
    const categoriesByLastUsed = this.getCategoriesSortedByLastUsed()
      .filter(cat => !this._pinnedCategories.has(cat));
    let freed = 0;

    for (const category of categoriesByLastUsed) {
      if (freed >= targetTokensToFree) break;

      const toolNames = this._loadedCategories.get(category);
      if (!toolNames) continue;

      // Estimate tokens that will be freed (tool definitions)
      const toolTokens = this.estimateToolDefinitionTokens(toolNames);
      this._toolManager.setEnabled(toolNames, false);
      this._loadedCategories.delete(category);
      freed += toolTokens;

      logger.debug({ category, toolCount: toolNames.length, freed: toolTokens },
        `[ToolCatalogPlugin] Compacted category '${category}'`);
    }

    this.invalidateTokenCache();
    return freed;
  }

  getState(): unknown {
    return {
      loadedCategories: Array.from(this._loadedCategories.keys()),
    };
  }

  restoreState(state: unknown): void {
    // Validate state shape
    if (!state || typeof state !== 'object') return;

    const s = state as Record<string, unknown>;
    if (!Array.isArray(s.loadedCategories) || s.loadedCategories.length === 0) return;

    // Re-load categories from state, skipping invalid entries
    for (const category of s.loadedCategories) {
      if (typeof category !== 'string' || !category) continue;
      const result = this.executeLoad(category);
      if (result.error) {
        logger.warn({ category, error: result.error },
          `[ToolCatalogPlugin] Failed to restore category '${category}'`);
      }
    }
    this.invalidateTokenCache();
  }

  destroy(): void {
    this._loadedCategories.clear();
    this._pinnedCategories.clear();
    this._toolManager = null;
    this._connectorCategories = null;
    this._destroyed = true;
  }

  // ========================================================================
  // Public API
  // ========================================================================

  /**
   * Set the ToolManager reference. Called by AgentContextNextGen after plugin registration.
   */
  setToolManager(tm: ToolManager): void {
    this._toolManager = tm;

    // Discover connector categories once at init (filtered by identities, not categoryScope)
    this._connectorCategories = ToolCatalogRegistry.discoverConnectorCategories({
      identities: this._config.identities,
    });

    // Load pinned categories first (always loaded, cannot be unloaded)
    for (const category of this._pinnedCategories) {
      const result = this.executeLoad(category);
      if (result.error) {
        logger.warn({ category, error: result.error },
          `[ToolCatalogPlugin] Failed to load pinned category '${category}'`);
      }
    }

    // Auto-load categories if configured (can be unloaded later)
    if (this._config.autoLoadCategories?.length) {
      for (const category of this._config.autoLoadCategories) {
        if (this._pinnedCategories.has(category)) continue; // Already loaded as pinned
        const result = this.executeLoad(category);
        if (result.error) {
          logger.warn({ category, error: result.error },
            `[ToolCatalogPlugin] Failed to auto-load category '${category}'`);
        }
      }
    }
  }

  /** Get list of currently loaded category names */
  get loadedCategories(): string[] {
    return Array.from(this._loadedCategories.keys());
  }

  /** Get set of pinned category names */
  get pinnedCategories(): ReadonlySet<string> {
    return this._pinnedCategories;
  }

  // ========================================================================
  // Metatool Implementations
  // ========================================================================

  private executeSearch(query?: string, category?: string, listAll?: boolean): Record<string, unknown> {
    if (this._destroyed) return { error: 'Plugin destroyed' };

    // List all tools across all categories
    if (listAll) {
      return this.listAllTools();
    }

    // List tools in a specific category
    if (category) {
      // Check if it's a connector category — scoped by identities, not categoryScope
      if (ToolCatalogRegistry.parseConnectorCategory(category) !== null) {
        return this.searchConnectorCategory(category);
      }

      if (!ToolCatalogRegistry.hasCategory(category)) {
        return { error: `Category '${category}' not found. Use tool_catalog_search with no params to see available categories.` };
      }

      // Built-in categories: check categoryScope
      if (!ToolCatalogRegistry.isCategoryAllowed(category, this._config.categoryScope)) {
        return { error: `Category '${category}' is not available for this agent.` };
      }

      const tools = ToolCatalogRegistry.getToolsInCategory(category);
      const loaded = this._loadedCategories.has(category);
      return {
        category,
        loaded,
        pinned: this._pinnedCategories.has(category),
        tools: tools.map(t => ({
          name: t.name,
          displayName: t.displayName,
          description: t.description,
          safeByDefault: t.safeByDefault,
        })),
      };
    }

    // Keyword search
    if (query) {
      return this.keywordSearch(query);
    }

    // No params — list all available categories
    const categories = this.getAllowedCategories();
    const connectorCats = this.getConnectorCategories();
    const result: Array<{
      name: string;
      displayName: string;
      description: string;
      toolCount: number;
      loaded: boolean;
      pinned: boolean;
    }> = [];

    for (const cat of categories) {
      const tools = ToolCatalogRegistry.getToolsInCategory(cat.name);
      result.push({
        name: cat.name,
        displayName: cat.displayName,
        description: cat.description,
        toolCount: tools.length,
        loaded: this._loadedCategories.has(cat.name),
        pinned: this._pinnedCategories.has(cat.name),
      });
    }

    for (const cc of connectorCats) {
      result.push({
        name: cc.name,
        displayName: cc.displayName,
        description: cc.description,
        toolCount: cc.toolCount,
        loaded: this._loadedCategories.has(cc.name),
        pinned: this._pinnedCategories.has(cc.name),
      });
    }

    return { categories: result };
  }

  executeLoad(category: string): Record<string, unknown> {
    if (this._destroyed) return { error: 'Plugin destroyed' };

    if (!this._toolManager) {
      return { error: 'ToolManager not connected. Plugin not properly initialized.' };
    }

    // Connector categories: scoped by identities (checked in discoverConnectorCategories),
    // not by categoryScope. Verify it's in our discovered set.
    const isConnector = ToolCatalogRegistry.parseConnectorCategory(category) !== null;
    if (isConnector) {
      const allowed = this.getConnectorCategories().some(cc => cc.name === category);
      if (!allowed) {
        return { error: `Category '${category}' is not available for this agent.` };
      }
    } else {
      // Built-in categories: check categoryScope
      if (!ToolCatalogRegistry.isCategoryAllowed(category, this._config.categoryScope)) {
        return { error: `Category '${category}' is not available for this agent.` };
      }
    }

    // Already loaded — idempotent
    if (this._loadedCategories.has(category)) {
      const toolNames = this._loadedCategories.get(category)!;
      return { loaded: toolNames.length, tools: toolNames, alreadyLoaded: true };
    }

    // Check max loaded limit (pinned don't count)
    const nonPinnedLoaded = this._loadedCategories.size - this._pinnedCategories.size;
    if (!this._pinnedCategories.has(category) && nonPinnedLoaded >= this._config.maxLoadedCategories) {
      return {
        error: `Maximum loaded categories (${this._config.maxLoadedCategories}) reached. Unload a category first.`,
        loaded: Array.from(this._loadedCategories.keys()),
      };
    }

    // Resolve tools
    let tools: Array<{ tool: ToolFunction; name: string }>;

    if (isConnector) {
      tools = ToolCatalogRegistry.resolveConnectorCategoryTools(category);
    } else {
      const entries = ToolCatalogRegistry.getToolsInCategory(category);
      if (entries.length === 0) {
        return { error: `Category '${category}' has no tools or does not exist.` };
      }
      tools = entries
        .filter(e => e.tool != null)
        .map(e => ({ tool: e.tool!, name: e.name }));
    }

    if (tools.length === 0) {
      return { error: `No tools found for category '${category}'.` };
    }

    // Register with ToolManager
    const toolNames: string[] = [];
    for (const { tool, name } of tools) {
      const existing = this._toolManager.getRegistration(name);
      if (existing) {
        // Already registered (maybe from a previous load) — just enable
        this._toolManager.setEnabled([name], true);
      } else {
        this._toolManager.register(tool, { category, source: `catalog:${category}` });
      }
      toolNames.push(name);
    }

    this._loadedCategories.set(category, toolNames);
    this.invalidateTokenCache();

    logger.debug({ category, toolCount: toolNames.length, tools: toolNames },
      `[ToolCatalogPlugin] Loaded category '${category}'`);

    return { loaded: toolNames.length, tools: toolNames };
  }

  private executeUnload(category: string): Record<string, unknown> {
    if (this._destroyed) return { error: 'Plugin destroyed' };

    if (!this._toolManager) {
      return { error: 'ToolManager not connected.' };
    }

    // Pinned categories cannot be unloaded
    if (this._pinnedCategories.has(category)) {
      return { error: `Category '${category}' is pinned and cannot be unloaded.` };
    }

    const toolNames = this._loadedCategories.get(category);
    if (!toolNames) {
      return { unloaded: 0, message: `Category '${category}' is not loaded.` };
    }

    // Disable tools (don't unregister — cheaper to re-enable later)
    this._toolManager.setEnabled(toolNames, false);
    this._loadedCategories.delete(category);
    this.invalidateTokenCache();

    logger.debug({ category, toolCount: toolNames.length },
      `[ToolCatalogPlugin] Unloaded category '${category}'`);

    return { unloaded: toolNames.length };
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  private getAllowedCategories(): ToolCategoryDefinition[] {
    return ToolCatalogRegistry.filterCategories(this._config.categoryScope);
  }

  /**
   * Get connector categories from cache (populated once in setToolManager).
   */
  private getConnectorCategories(): ConnectorCategoryInfo[] {
    return this._connectorCategories ?? [];
  }

  /**
   * Build status markers for a category (e.g., " [PINNED]", " [LOADED]", " [PINNED] [LOADED]")
   */
  private getCategoryMarkers(name: string): string {
    const parts: string[] = [];
    if (this._pinnedCategories.has(name)) parts.push('[PINNED]');
    if (this._loadedCategories.has(name)) parts.push('[LOADED]');
    return parts.length > 0 ? ' ' + parts.join(' ') : '';
  }

  /**
   * Build dynamic instructions that include the list of available categories.
   */
  private buildInstructions(): string {
    const lines: string[] = [];

    lines.push('## Tool Catalog');
    lines.push('');
    lines.push('Your core tools (memory, context, instructions, etc.) are always available.');
    lines.push('Additional tool categories can be loaded on demand from the catalog below.');
    lines.push('');
    lines.push('**tool_catalog_search** — Browse available tool categories and search for specific tools.');
    lines.push('  - No params → list all available categories with descriptions');
    lines.push('  - `category` → list tools in that category');
    lines.push('  - `query` → keyword search across categories and tools');
    lines.push('');
    lines.push('**tool_catalog_load** — Load a category\'s tools so you can use them.');
    lines.push('  - Tools become available immediately after loading.');
    lines.push('  - If you need tools from a category, load it first.');
    lines.push('');
    lines.push('**tool_catalog_unload** — Unload a category to free token budget.');
    lines.push('  - Unloaded tools are no longer sent to you.');
    lines.push('  - Use when you\'re done with a category.');
    lines.push('  - Pinned categories cannot be unloaded.');
    lines.push('');

    // List available categories
    const builtIn = this.getAllowedCategories();
    const connectors = this.getConnectorCategories();

    if (builtIn.length > 0 || connectors.length > 0) {
      lines.push('**Available categories:**');
      for (const cat of builtIn) {
        const tools = ToolCatalogRegistry.getToolsInCategory(cat.name);
        const pinned = this._pinnedCategories.has(cat.name) ? ' [PINNED]' : '';
        lines.push(`- ${cat.name} (${tools.length} tools)${pinned}: ${cat.description}`);
      }
      for (const cc of connectors) {
        const pinned = this._pinnedCategories.has(cc.name) ? ' [PINNED]' : '';
        lines.push(`- ${cc.name} (${cc.toolCount} tools)${pinned}: ${cc.description}`);
      }
      lines.push('');
    }

    lines.push('**Best practices:**');
    lines.push('- Search first to find the right category before loading.');
    lines.push('- Unload categories you no longer need to keep context lean.');
    lines.push('- Categories marked [LOADED] are already available.');
    lines.push('- Categories marked [PINNED] are always available and cannot be unloaded.');

    return lines.join('\n');
  }

  private listAllTools(): Record<string, unknown> {
    const categories: Array<{
      category: string;
      displayName: string;
      description: string;
      loaded: boolean;
      pinned: boolean;
      tools: Array<{ name: string; displayName: string; description: string; safeByDefault?: boolean }>;
    }> = [];

    let totalTools = 0;

    // Built-in categories
    for (const cat of this.getAllowedCategories()) {
      const tools = ToolCatalogRegistry.getToolsInCategory(cat.name);
      totalTools += tools.length;
      categories.push({
        category: cat.name,
        displayName: cat.displayName,
        description: cat.description,
        loaded: this._loadedCategories.has(cat.name),
        pinned: this._pinnedCategories.has(cat.name),
        tools: tools.map(t => ({
          name: t.name,
          displayName: t.displayName,
          description: t.description,
          safeByDefault: t.safeByDefault,
        })),
      });
    }

    // Connector categories
    for (const cc of this.getConnectorCategories()) {
      totalTools += cc.toolCount;
      categories.push({
        category: cc.name,
        displayName: cc.displayName,
        description: cc.description,
        loaded: this._loadedCategories.has(cc.name),
        pinned: this._pinnedCategories.has(cc.name),
        tools: cc.tools.map(t => ({
          name: t.definition.function.name,
          displayName: t.definition.function.name.replace(/_/g, ' '),
          description: t.definition.function.description || '',
        })),
      });
    }

    return { categories, totalCategories: categories.length, totalTools };
  }

  private keywordSearch(query: string): Record<string, unknown> {
    const lq = query.toLowerCase();
    const results: Array<{
      category: string;
      categoryDisplayName: string;
      tools: Array<{ name: string; displayName: string; description: string }>;
    }> = [];

    // Search registered categories
    for (const cat of this.getAllowedCategories()) {
      const catMatch = cat.name.toLowerCase().includes(lq) ||
        cat.displayName.toLowerCase().includes(lq) ||
        cat.description.toLowerCase().includes(lq);

      const tools = ToolCatalogRegistry.getToolsInCategory(cat.name);
      const matchingTools = tools.filter(t =>
        t.name.toLowerCase().includes(lq) ||
        t.displayName.toLowerCase().includes(lq) ||
        t.description.toLowerCase().includes(lq),
      );

      if (catMatch || matchingTools.length > 0) {
        results.push({
          category: cat.name,
          categoryDisplayName: cat.displayName,
          tools: (catMatch ? tools : matchingTools).map(t => ({
            name: t.name,
            displayName: t.displayName,
            description: t.description,
          })),
        });
      }
    }

    // Search connector categories (from cache)
    for (const cc of this.getConnectorCategories()) {
      if (cc.name.toLowerCase().includes(lq) ||
        cc.displayName.toLowerCase().includes(lq) ||
        cc.description.toLowerCase().includes(lq)) {
        results.push({
          category: cc.name,
          categoryDisplayName: cc.displayName,
          tools: cc.tools.map(t => ({
            name: t.definition.function.name,
            displayName: t.definition.function.name.replace(/_/g, ' '),
            description: t.definition.function.description || '',
          })),
        });
      }
    }

    return { query, results, totalMatches: results.length };
  }

  private searchConnectorCategory(category: string): Record<string, unknown> {
    // Verify this connector category is in our discovered set (filtered by identities)
    const allowed = this.getConnectorCategories().some(cc => cc.name === category);
    if (!allowed) {
      return { error: `Category '${category}' is not available for this agent.` };
    }

    const connectorName = ToolCatalogRegistry.parseConnectorCategory(category);
    const tools = ToolCatalogRegistry.resolveConnectorCategoryTools(category);
    const loaded = this._loadedCategories.has(category);

    return {
      category,
      loaded,
      pinned: this._pinnedCategories.has(category),
      connectorName,
      tools: tools.map(t => ({
        name: t.name,
        description: t.tool.definition.function.description || '',
      })),
    };
  }

  private getCategoriesSortedByLastUsed(): string[] {
    if (!this._toolManager) return Array.from(this._loadedCategories.keys());

    const categoryLastUsed: Array<{ category: string; lastUsed: number }> = [];

    for (const [category, toolNames] of this._loadedCategories) {
      let maxLastUsed = 0;
      for (const name of toolNames) {
        const reg = this._toolManager.getRegistration(name);
        if (reg?.metadata?.lastUsed) {
          const ts = reg.metadata.lastUsed instanceof Date
            ? reg.metadata.lastUsed.getTime()
            : 0;
          if (ts > maxLastUsed) maxLastUsed = ts;
        }
      }
      categoryLastUsed.push({ category, lastUsed: maxLastUsed });
    }

    // Sort ascending — least recently used first
    categoryLastUsed.sort((a, b) => a.lastUsed - b.lastUsed);
    return categoryLastUsed.map(c => c.category);
  }

  private estimateToolDefinitionTokens(toolNames: string[]): number {
    let total = 0;
    for (const name of toolNames) {
      const reg = this._toolManager?.getRegistration(name);
      if (reg) {
        // Check WeakMap cache first
        const defObj = reg.tool.definition;
        const cached = this._toolTokenCache.get(defObj);
        if (cached !== undefined) {
          total += cached;
        } else {
          const defStr = JSON.stringify(defObj);
          const tokens = this.estimator.estimateTokens(defStr);
          this._toolTokenCache.set(defObj, tokens);
          total += tokens;
        }
      }
    }
    return total;
  }
}
