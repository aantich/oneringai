/**
 * IConnectorRegistry - Read-only interface for connector lookup
 *
 * Covers the read-only subset of Connector static methods.
 * Used by ScopedConnectorRegistry to provide filtered views
 * and by consumers that only need to read from the registry.
 */

import type { Connector } from '../../core/Connector.js';

export interface IConnectorRegistry {
  /** Get a connector by name. Throws if not found (or not accessible). */
  get(name: string): Connector;

  /** Check if a connector exists (and is accessible) */
  has(name: string): boolean;

  /** List all accessible connector names */
  list(): string[];

  /** List all accessible connector instances */
  listAll(): Connector[];

  /** Get number of accessible connectors */
  size(): number;

  /** Get connector descriptions formatted for tool parameters */
  getDescriptionsForTools(): string;

  /** Get connector info map */
  getInfo(): Record<string, { displayName: string; description: string; baseURL: string }>;

  /** Get a connector by ID. Optional — not all registries support ID-based lookup. */
  getById?(id: string): Connector;
}
