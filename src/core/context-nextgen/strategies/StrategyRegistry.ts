/**
 * StrategyRegistry - Centralized registry for compaction strategies
 *
 * Follows the Connector pattern: static registry with register/get/list methods.
 * Auto-registers built-in strategy classes on first access.
 *
 * Each registered entry represents an actual strategy CLASS.
 * Library users can register their own custom strategy classes.
 *
 * Strategy metadata (name, displayName, description, threshold) comes from
 * the strategy class itself via the ICompactionStrategy interface.
 *
 * @example
 * ```typescript
 * // Get available strategies for UI
 * const strategies = StrategyRegistry.getInfo();
 *
 * // Create a strategy instance
 * const strategy = StrategyRegistry.create('default');
 *
 * // Register a custom strategy class (metadata comes from the class)
 * StrategyRegistry.register(SmartCompactionStrategy);
 *
 * // Register with isBuiltIn flag
 * StrategyRegistry.register(SmartCompactionStrategy, { isBuiltIn: false });
 * ```
 */

import type { ICompactionStrategy } from '../types.js';
import { DefaultCompactionStrategy } from './DefaultCompactionStrategy.js';
import { AlgorithmicCompactionStrategy } from './AlgorithmicCompactionStrategy.js';
import { ObservationMaskingStrategy } from './ObservationMaskingStrategy.js';
import { StructuredSummaryStrategy } from './StructuredSummaryStrategy.js';

/**
 * Strategy constructor type
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StrategyClass = new (config?: any) => ICompactionStrategy;

/**
 * Strategy information for UI display (serializable, no class reference)
 */
export interface StrategyInfo {
  /** Strategy name (unique identifier) */
  name: string;

  /** Human-readable name for UI */
  displayName: string;

  /** Description explaining the strategy behavior */
  description: string;

  /** Compaction threshold (0-1, e.g., 0.70 = 70%) */
  threshold: number;

  /** Whether this is a built-in strategy */
  isBuiltIn: boolean;
}

/**
 * Full strategy registry entry (includes class reference)
 */
export interface StrategyRegistryEntry extends StrategyInfo {
  /** Strategy constructor class */
  strategyClass: StrategyClass;
}

/**
 * Options for registering a strategy
 */
export interface StrategyRegisterOptions {
  /** Whether this is a built-in strategy (default: false) */
  isBuiltIn?: boolean;
}

/**
 * Strategy Registry - manages compaction strategy registration and creation.
 *
 * Features:
 * - Static registry pattern (like Connector)
 * - Auto-registers built-in strategy classes on first access
 * - Supports custom strategy class registration
 * - Provides UI-safe getInfo() for serialization
 * - Metadata (displayName, description) comes from strategy class
 */
export class StrategyRegistry {
  private static registry: Map<string, StrategyRegistryEntry> = new Map();
  private static initialized = false;

  /**
   * Ensure built-in strategies are registered
   */
  private static ensureInitialized(): void {
    if (this.initialized) return;

    // Register the built-in strategies
    this.registerInternal(DefaultCompactionStrategy, { isBuiltIn: true });
    this.registerInternal(AlgorithmicCompactionStrategy, { isBuiltIn: true });

    this.registerInternal(ObservationMaskingStrategy, { isBuiltIn: true });
    this.registerInternal(StructuredSummaryStrategy, { isBuiltIn: true });

    this.initialized = true;
  }

  /**
   * Internal registration that reads metadata from strategy instance
   */
  private static registerInternal(
    strategyClass: StrategyClass,
    options: StrategyRegisterOptions = {}
  ): void {
    // Create temporary instance to read metadata
    const instance = new strategyClass();

    const entry: StrategyRegistryEntry = {
      name: instance.name,
      displayName: instance.displayName,
      description: instance.description,
      threshold: instance.threshold,
      isBuiltIn: options.isBuiltIn ?? false,
      strategyClass,
    };

    if (this.registry.has(entry.name)) {
      throw new Error(
        `Strategy '${entry.name}' is already registered. Available strategies: ${this.list().join(', ')}`
      );
    }

    this.registry.set(entry.name, entry);
  }

  /**
   * Register a new strategy class.
   *
   * Metadata (name, displayName, description, threshold) is read from
   * the strategy class itself.
   *
   * @param strategyClass - Strategy class to register
   * @param options - Registration options (isBuiltIn defaults to false)
   * @throws Error if a strategy with this name already exists
   *
   * @example
   * ```typescript
   * // Simple registration
   * StrategyRegistry.register(SmartCompactionStrategy);
   *
   * // With options
   * StrategyRegistry.register(SmartCompactionStrategy, { isBuiltIn: false });
   * ```
   */
  static register(strategyClass: StrategyClass, options?: StrategyRegisterOptions): void {
    this.ensureInitialized();
    this.registerInternal(strategyClass, options);
  }

  /**
   * Get a strategy entry by name.
   *
   * @throws Error if strategy not found
   */
  static get(name: string): StrategyRegistryEntry {
    this.ensureInitialized();

    const entry = this.registry.get(name);
    if (!entry) {
      throw new Error(
        `Strategy '${name}' not found. Available strategies: ${this.list().join(', ')}`
      );
    }

    return entry;
  }

  /**
   * Check if a strategy exists.
   */
  static has(name: string): boolean {
    this.ensureInitialized();
    return this.registry.has(name);
  }

  /**
   * List all registered strategy names.
   */
  static list(): string[] {
    this.ensureInitialized();
    return Array.from(this.registry.keys());
  }

  /**
   * Create a strategy instance by name.
   *
   * @param name - Strategy name
   * @param config - Optional configuration for the strategy
   * @throws Error if strategy not found
   */
  static create(name: string, config?: unknown): ICompactionStrategy {
    const entry = this.get(name);
    return new entry.strategyClass(config);
  }

  /**
   * Get strategy information for UI display (serializable, no class refs).
   *
   * Returns array of StrategyInfo objects that can be safely serialized
   * and sent over IPC.
   */
  static getInfo(): StrategyInfo[] {
    this.ensureInitialized();

    return Array.from(this.registry.values()).map(
      ({ name, displayName, description, threshold, isBuiltIn }) => ({
        name,
        displayName,
        description,
        threshold,
        isBuiltIn,
      })
    );
  }

  /**
   * Remove a strategy from the registry.
   *
   * @param name - Strategy name to remove
   * @returns true if removed, false if not found
   * @throws Error if trying to remove a built-in strategy
   */
  static remove(name: string): boolean {
    this.ensureInitialized();

    const entry = this.registry.get(name);
    if (!entry) {
      return false;
    }

    if (entry.isBuiltIn) {
      throw new Error(`Cannot remove built-in strategy '${name}'`);
    }

    return this.registry.delete(name);
  }

  /**
   * Get a strategy entry without throwing.
   * Returns undefined if not found.
   */
  static getIfExists(name: string): StrategyRegistryEntry | undefined {
    this.ensureInitialized();
    return this.registry.get(name);
  }

  /**
   * Reset the registry to initial state (for testing).
   * @internal
   */
  static _reset(): void {
    this.registry.clear();
    this.initialized = false;
  }
}
