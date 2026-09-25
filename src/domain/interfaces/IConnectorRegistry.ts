/**
 * IConnectorRegistry - Read-only interface for connector lookup
 *
 * Covers the read-only subset of Connector static methods.
 * Used by ScopedConnectorRegistry to provide filtered views
 * and by consumers that only need to read from the registry.
 */

import type { Connector } from '../../core/Connector.js';

export interface IConnectorRegistry {
  /**
   * Get a connector by name. Throw ConnectorNotFoundError when missing or hidden
   * in this scope, with no disclosure of inaccessible connectors. Propagate
   * authentication, configuration and storage failures without reclassifying
   * them as absence. Connector.get() preserves custom-registry errors unchanged.
   */
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

  /**
   * Get a connector by ID. Optional — not all registries support ID-based lookup.
   * Uses the same ConnectorNotFoundError contract as get().
   */
  getById?(id: string): Connector;

  /**
   * Optional async warmup — called before sync reads to ensure connectors are loaded.
   *
   * Multi-tenant registries can implement this to lazily load connectors for the
   * current request context (e.g., tenant/group). Entry points call Connector.warmup()
   * which delegates here. After warmup completes, all sync read methods (get, has,
   * list, listAll) must return correct results without further async work.
   */
  warmup?(): Promise<void>;
}
