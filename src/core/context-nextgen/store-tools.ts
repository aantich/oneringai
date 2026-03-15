/**
 * StoreToolsManager - Unified CRUD tools for all IStoreHandler plugins
 *
 * Creates 5 generic tools (store_get, store_set, store_delete, store_list, store_action)
 * that route to the correct plugin handler based on the `store` parameter.
 *
 * Registered once on the first IStoreHandler plugin registration.
 * Subsequent handlers are added dynamically; `descriptionFactory` picks them up.
 */

import type { ToolFunction } from '../../domain/entities/Tool.js';
import type { ToolContext } from '../../domain/entities/Tool.js';
import type { IStoreHandler, StoreEntrySchema } from './types.js';

// ============================================================================
// StoreToolsManager
// ============================================================================

export class StoreToolsManager {
  private handlers = new Map<string, IStoreHandler>();

  /**
   * Register a store handler. Throws on duplicate storeId.
   */
  registerHandler(handler: IStoreHandler): void {
    const schema = handler.getStoreSchema();
    if (this.handlers.has(schema.storeId)) {
      throw new Error(`Store handler with storeId '${schema.storeId}' is already registered`);
    }
    this.handlers.set(schema.storeId, handler);
  }

  /**
   * Unregister a store handler by storeId.
   */
  unregisterHandler(storeId: string): boolean {
    return this.handlers.delete(storeId);
  }

  /**
   * Get a handler by storeId.
   */
  getHandler(storeId: string): IStoreHandler | undefined {
    return this.handlers.get(storeId);
  }

  /**
   * Get all registered store schemas (for building tool descriptions).
   */
  getSchemas(): StoreEntrySchema[] {
    return Array.from(this.handlers.values()).map(h => h.getStoreSchema());
  }

  /**
   * Get all registered store IDs.
   */
  getStoreIds(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Create the 5 generic store tools.
   * Called once when the first IStoreHandler is registered.
   */
  getTools(): ToolFunction[] {
    return [
      this.createStoreGetTool(),
      this.createStoreSetTool(),
      this.createStoreDeleteTool(),
      this.createStoreListTool(),
      this.createStoreActionTool(),
    ];
  }

  /**
   * Cleanup.
   */
  destroy(): void {
    this.handlers.clear();
  }

  // ============================================================================
  // Description Builders
  // ============================================================================

  /**
   * Build the unified overview block for system instructions.
   * Emitted once when any IStoreHandler plugins are registered.
   * Covers: what store_* tools are, available stores, and when to use each.
   */
  buildOverview(): string {
    const schemas = this.getSchemas();
    if (schemas.length === 0) return '';

    const storeLines = schemas.map(s =>
      `- **"${s.storeId}"** (${s.displayName}): ${s.description}\n  ${s.usageHint}`,
    );

    return `## Data Stores

You have ${schemas.length} data store${schemas.length > 1 ? 's' : ''} accessible through 5 unified tools: \`store_set\`, \`store_get\`, \`store_delete\`, \`store_list\`, \`store_action\`.

Every call requires a \`store\` parameter to select the target store. Pass all other fields as top-level parameters (flat — no nested \`data\` or \`params\` wrapper).

**Available stores:**
${storeLines.join('\n')}

**Quick reference:**
- \`store_set({ store: "...", key: "...", ...fields })\` — create or update an entry
- \`store_get({ store: "...", key?: "..." })\` — retrieve one entry or all
- \`store_delete({ store: "...", key: "..." })\` — remove an entry
- \`store_list({ store: "...", ...filters? })\` — list entries with optional filtering
- \`store_action({ store: "...", action: "...", ...params? })\` — store-specific operations

See each store's section below for behavior rules, workflows, and store-specific fields.`;
  }

  /**
   * Build the store comparison section for tool descriptions.
   * Called dynamically via descriptionFactory so it always reflects current handlers.
   */
  private buildStoreDescriptions(mode: 'get' | 'set' | 'delete' | 'list' | 'action'): string {
    const schemas = this.getSchemas();
    if (schemas.length === 0) return 'No stores available.';

    const lines: string[] = [];
    for (const schema of schemas) {
      if (mode === 'set') {
        // For store_set: show store ID + required/optional fields
        lines.push(`- "${schema.storeId}": ${schema.setDataFields.replace(/\n/g, ', ')}`);
      } else if (mode === 'action' && schema.actions) {
        // For store_action: show store ID + available actions
        const actionNames = Object.keys(schema.actions);
        if (actionNames.length > 0) {
          const actionDescs = actionNames.map(a => {
            const info = schema.actions?.[a];
            return `${a}${info?.destructive ? ' (destructive)' : ''}: ${info?.description ?? ''}`;
          });
          lines.push(`- "${schema.storeId}": ${actionDescs.join('; ')}`);
        }
      } else {
        // For get/delete/list: just list store IDs
        lines.push(`"${schema.storeId}"`);
      }
    }

    if (mode === 'set') {
      return `Store-specific fields (pass as top-level params):\n${lines.join('\n')}`;
    }
    if (mode === 'action') {
      return `Store-specific actions:\n${lines.join('\n')}`;
    }
    return `Available stores: ${lines.join(', ')}`;
  }

  // ============================================================================
  // Tool Factories
  // ============================================================================

  private createStoreGetTool(): ToolFunction {
    return {
      definition: {
        type: 'function',
        function: {
          name: 'store_get',
          description: 'Retrieve an entry from a data store by key, or get all entries if no key provided.',
          parameters: {
            type: 'object',
            properties: {
              store: { type: 'string', description: 'Target store name' },
              key: { type: 'string', description: 'Key to retrieve. Omit to get all entries.' },
            },
            required: ['store'],
          },
        },
      },
      descriptionFactory: () => {
        return `Retrieve an entry from a data store by key, or get all entries if no key provided.\n\n${this.buildStoreDescriptions('get')}`;
      },
      execute: async (args: Record<string, unknown>, context?: ToolContext) => {
        const handler = this.resolveHandler(args.store as string);
        return handler.storeGet(args.key as string | undefined, context);
      },
      permission: { scope: 'always', riskLevel: 'low' },
      describeCall: (args) => `get ${args.key ?? 'all'} from ${args.store}`,
    };
  }

  private createStoreSetTool(): ToolFunction {
    return {
      definition: {
        type: 'function',
        function: {
          name: 'store_set',
          description: 'Create or update an entry in a data store.',
          parameters: {
            type: 'object',
            properties: {
              store: { type: 'string', description: 'Target store name' },
              key: { type: 'string', description: 'Unique key for the entry' },
            },
            required: ['store', 'key'],
            additionalProperties: true,
          },
        },
      },
      descriptionFactory: () => {
        return `Create or update an entry in a data store. Pass store-specific fields as top-level parameters alongside store and key.\n\n${this.buildStoreDescriptions('set')}`;
      },
      execute: async (args: Record<string, unknown>, context?: ToolContext) => {
        const handler = this.resolveHandler(args.store as string);
        // Extract data fields: everything except store/key routing params.
        // Supports both flat args { store, key, value, description } and legacy { store, key, data: {...} }
        let data: Record<string, unknown>;
        if (args.data && typeof args.data === 'object' && !Array.isArray(args.data)) {
          data = args.data as Record<string, unknown>;
        } else {
          const { store: _s, key: _k, ...rest } = args;
          data = rest;
        }
        return handler.storeSet(args.key as string, data, context);
      },
      permission: { scope: 'always', riskLevel: 'low' },
      describeCall: (args) => `set ${args.key} in ${args.store}`,
    };
  }

  private createStoreDeleteTool(): ToolFunction {
    return {
      definition: {
        type: 'function',
        function: {
          name: 'store_delete',
          description: 'Delete an entry from a data store by key.',
          parameters: {
            type: 'object',
            properties: {
              store: { type: 'string', description: 'Target store name' },
              key: { type: 'string', description: 'Key to delete' },
            },
            required: ['store', 'key'],
          },
        },
      },
      descriptionFactory: () => {
        return `Delete an entry from a data store by key.\n\n${this.buildStoreDescriptions('delete')}`;
      },
      execute: async (args: Record<string, unknown>, context?: ToolContext) => {
        const handler = this.resolveHandler(args.store as string);
        return handler.storeDelete(args.key as string, context);
      },
      permission: { scope: 'always', riskLevel: 'low' },
      describeCall: (args) => `delete ${args.key} from ${args.store}`,
    };
  }

  private createStoreListTool(): ToolFunction {
    return {
      definition: {
        type: 'function',
        function: {
          name: 'store_list',
          description: 'List entries in a data store with optional filters.',
          parameters: {
            type: 'object',
            properties: {
              store: { type: 'string', description: 'Target store name' },
            },
            required: ['store'],
            additionalProperties: true,
          },
        },
      },
      descriptionFactory: () => {
        return `List entries in a data store. Returns summaries, not full values. Pass filter fields as top-level parameters alongside store.\n\n${this.buildStoreDescriptions('list')}`;
      },
      execute: async (args: Record<string, unknown>, context?: ToolContext) => {
        const handler = this.resolveHandler(args.store as string);
        // Support both { filter: {...} } and flat filter args { store, status, tags }
        let filter: Record<string, unknown> | undefined;
        if (args.filter && typeof args.filter === 'object' && !Array.isArray(args.filter)) {
          filter = args.filter as Record<string, unknown>;
        } else {
          const { store: _s, ...rest } = args;
          filter = Object.keys(rest).length > 0 ? rest : undefined;
        }
        return handler.storeList(filter, context);
      },
      permission: { scope: 'always', riskLevel: 'low' },
      describeCall: (args) => {
        const { store, filter, ...rest } = args;
        const hasFilter = filter || Object.keys(rest).length > 0;
        return `list ${store}${hasFilter ? ' (filtered)' : ''}`;
      },
    };
  }

  private createStoreActionTool(): ToolFunction {
    return {
      definition: {
        type: 'function',
        function: {
          name: 'store_action',
          description: 'Execute a store-specific action.',
          parameters: {
            type: 'object',
            properties: {
              store: { type: 'string', description: 'Target store name' },
              action: { type: 'string', description: 'Action name' },
            },
            required: ['store', 'action'],
            additionalProperties: true,
          },
        },
      },
      descriptionFactory: () => {
        return `Execute a store-specific action (e.g., clear, cleanup, query).\nDestructive actions require { confirm: true } as a parameter.\n\n${this.buildStoreDescriptions('action')}`;
      },
      execute: async (args: Record<string, unknown>, context?: ToolContext) => {
        const handler = this.resolveHandler(args.store as string);
        const action = args.action as string;

        // Support both { params: {...} } and flat params { store, action, message, confirm }
        let params: Record<string, unknown> | undefined;
        if (args.params && typeof args.params === 'object' && !Array.isArray(args.params)) {
          params = args.params as Record<string, unknown>;
        } else {
          const { store: _s, action: _a, ...rest } = args;
          params = Object.keys(rest).length > 0 ? rest : undefined;
        }

        // Check if handler supports actions
        if (!handler.storeAction) {
          return {
            success: false,
            action,
            error: `Store "${args.store}" does not support actions`,
          };
        }

        // Check destructive action confirmation
        const schema = handler.getStoreSchema();
        const actionDef = schema.actions?.[action];
        if (actionDef?.destructive && !params?.confirm) {
          return {
            success: false,
            action,
            error: `Action "${action}" is destructive and requires { confirm: true }`,
          };
        }

        return handler.storeAction(action, params, context);
      },
      permission: { scope: 'always', riskLevel: 'low' },
      describeCall: (args) => `${args.action} on ${args.store}`,
    };
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private resolveHandler(storeId: string): IStoreHandler {
    const handler = this.handlers.get(storeId);
    if (!handler) {
      const available = this.getStoreIds().join(', ');
      throw new Error(
        `Unknown store "${storeId}". Available stores: ${available || 'none'}`,
      );
    }
    return handler;
  }
}
