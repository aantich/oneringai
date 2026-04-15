/**
 * ScopedConnectorRegistry - Filtered view over the Connector registry
 *
 * Provides access-controlled connector lookup by delegating to
 * Connector static methods and filtering through an IConnectorAccessPolicy.
 *
 * Security: get() on a denied connector throws the same "not found" error
 * listing only visible connectors — no information leakage.
 */

import { Connector } from './Connector.js';
import type { IConnectorRegistry } from '../domain/interfaces/IConnectorRegistry.js';
import type { IConnectorAccessPolicy, ConnectorAccessContext } from '../domain/interfaces/IConnectorAccessPolicy.js';

export class ScopedConnectorRegistry implements IConnectorRegistry {
  constructor(
    private readonly policy: IConnectorAccessPolicy,
    private readonly context: ConnectorAccessContext
  ) {}

  get(name: string): Connector {
    if (!Connector.has(name)) {
      const available = this.list().join(', ') || 'none';
      throw new Error(`Connector '${name}' not found. Available: ${available}`);
    }
    const connector = Connector.get(name);
    if (!this.policy.canAccess(connector, this.context)) {
      // Same error message shape — no information leakage about existence
      const available = this.list().join(', ') || 'none';
      throw new Error(`Connector '${name}' not found. Available: ${available}`);
    }
    return connector;
  }

  has(name: string): boolean {
    if (!Connector.has(name)) return false;
    const connector = Connector.get(name);
    return this.policy.canAccess(connector, this.context);
  }

  list(): string[] {
    return this.listAll().map((c) => c.name);
  }

  listAll(): Connector[] {
    return Connector.listAll().filter((c) => this.policy.canAccess(c, this.context));
  }

  size(): number {
    return this.listAll().length;
  }

  getDescriptionsForTools(): string {
    const connectors = this.listAll();
    if (connectors.length === 0) {
      return 'No connectors registered yet.';
    }
    return connectors
      .map((c) => `  - "${c.name}": ${c.displayName} - ${c.config.description || 'No description'}`)
      .join('\n');
  }

  getInfo(): Record<string, { displayName: string; description: string; baseURL: string }> {
    const info: Record<string, { displayName: string; description: string; baseURL: string }> = {};
    for (const connector of this.listAll()) {
      info[connector.name] = {
        displayName: connector.displayName,
        description: connector.config.description || '',
        baseURL: connector.baseURL,
      };
    }
    return info;
  }

  getById(id: string): Connector {
    const connector = Connector.getById(id);
    if (!this.policy.canAccess(connector, this.context)) {
      const available = this.list().join(', ') || 'none';
      throw new Error(`Connector with id '${id}' not found. Available: ${available}`);
    }
    return connector;
  }
}
