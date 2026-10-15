/**
 * StrategyRegistry Tests
 *
 * Tests for the centralized strategy registry system.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StrategyRegistry } from '@/core/context-nextgen/strategies/StrategyRegistry.js';
import { DefaultCompactionStrategy } from '@/core/context-nextgen/strategies/DefaultCompactionStrategy.js';
import type {
  ICompactionStrategy,
  CompactionContext,
  CompactionResult,
  ConsolidationResult,
} from '@/core/context-nextgen/types.js';

describe('StrategyRegistry', () => {
  beforeEach(() => {
    // Reset registry before each test
    StrategyRegistry._reset();
  });

  describe('Built-in Strategy', () => {
    it('should have default strategy registered', () => {
      expect(StrategyRegistry.has('default')).toBe(true);
    });

    it('should list built-in strategies initially', () => {
      const strategies = StrategyRegistry.list();
      expect(strategies).toContain('default');
      expect(strategies).toContain('algorithmic');
      expect(strategies).toEqual(['default', 'algorithmic', 'observation-masking', 'structured-summary']);
    });

    it('should return correct info for default strategy', () => {
      const info = StrategyRegistry.getInfo();
      expect(info).toHaveLength(4);
      expect(info.find(s => s.name === 'default')).toEqual({
        name: 'default',
        displayName: 'Dumb',
        description: 'Do not use',
        threshold: 0.7,
        isBuiltIn: true,
      });
    });

    it('should create default strategy instance', () => {
      const strategy = StrategyRegistry.create('default');
      expect(strategy).toBeInstanceOf(DefaultCompactionStrategy);
      expect(strategy.name).toBe('default');
      expect(strategy.threshold).toBe(0.7);
    });

    it('should include displayName and description on default strategy instance', () => {
      const strategy = StrategyRegistry.create('default');
      expect(strategy.displayName).toBe('Dumb');
      expect(strategy.description).toBe('Do not use');
    });
  });

  describe('Custom Strategy Registration', () => {
    // Custom strategy class for testing - now includes displayName and description
    class CustomStrategy implements ICompactionStrategy {
      readonly name = 'custom';
      readonly displayName = 'Custom Strategy';
      readonly description = 'A custom compaction strategy for testing';
      readonly threshold = 0.85;

      async compact(
        _context: CompactionContext,
        _targetToFree: number
      ): Promise<CompactionResult> {
        return { tokensFreed: 0, messagesRemoved: 0, pluginsCompacted: [], log: [] };
      }

      async consolidate(_context: CompactionContext): Promise<ConsolidationResult> {
        return { performed: false, tokensChanged: 0, actions: [] };
      }
    }

    it('should register custom strategy from class', () => {
      StrategyRegistry.register(CustomStrategy);

      expect(StrategyRegistry.has('custom')).toBe(true);
      expect(StrategyRegistry.list()).toContain('custom');
    });

    it('should create custom strategy instance', () => {
      StrategyRegistry.register(CustomStrategy);

      const strategy = StrategyRegistry.create('custom');
      expect(strategy).toBeInstanceOf(CustomStrategy);
      expect(strategy.threshold).toBe(0.85);
    });

    it('should read metadata from strategy class', () => {
      StrategyRegistry.register(CustomStrategy);

      const info = StrategyRegistry.getInfo();
      const customInfo = info.find(s => s.name === 'custom');

      expect(customInfo).toEqual({
        name: 'custom',
        displayName: 'Custom Strategy',
        description: 'A custom compaction strategy for testing',
        threshold: 0.85,
        isBuiltIn: false,
      });
    });

    it('should include custom strategy in getInfo', () => {
      StrategyRegistry.register(CustomStrategy);

      const info = StrategyRegistry.getInfo();
      expect(info).toHaveLength(5); // 4 built-in + 1 custom
      expect(info.map(s => s.name)).toContain('custom');
    });

    it('should throw when registering duplicate strategy', () => {
      StrategyRegistry.register(CustomStrategy);

      // Create another class with same name
      class DuplicateStrategy implements ICompactionStrategy {
        readonly name = 'custom'; // Same name!
        readonly displayName = 'Duplicate';
        readonly description = 'Another custom strategy';
        readonly threshold = 0.9;

        async compact(): Promise<CompactionResult> {
          return { tokensFreed: 0, messagesRemoved: 0, pluginsCompacted: [], log: [] };
        }

        async consolidate(): Promise<ConsolidationResult> {
          return { performed: false, tokensChanged: 0, actions: [] };
        }
      }

      expect(() => {
        StrategyRegistry.register(DuplicateStrategy);
      }).toThrow(/already registered/);
    });

    it('should support isBuiltIn option', () => {
      // Note: In practice, only library strategies should use isBuiltIn: true
      class BuiltInLikeStrategy implements ICompactionStrategy {
        readonly name = 'builtin-like';
        readonly displayName = 'Built-in Like';
        readonly description = 'A strategy registered as built-in';
        readonly threshold = 0.8;

        async compact(): Promise<CompactionResult> {
          return { tokensFreed: 0, messagesRemoved: 0, pluginsCompacted: [], log: [] };
        }

        async consolidate(): Promise<ConsolidationResult> {
          return { performed: false, tokensChanged: 0, actions: [] };
        }
      }

      StrategyRegistry.register(BuiltInLikeStrategy, { isBuiltIn: true });

      const info = StrategyRegistry.getInfo().find(s => s.name === 'builtin-like');
      expect(info?.isBuiltIn).toBe(true);
    });

    it('should support strategy with requiredPlugins', () => {
      class PluginDependentStrategy implements ICompactionStrategy {
        readonly name = 'plugin-dependent';
        readonly displayName = 'Plugin Dependent';
        readonly description = 'A strategy that requires specific plugins';
        readonly threshold = 0.75;
        readonly requiredPlugins = ['working_memory', 'custom_plugin'] as const;

        async compact(): Promise<CompactionResult> {
          return { tokensFreed: 0, messagesRemoved: 0, pluginsCompacted: [], log: [] };
        }

        async consolidate(): Promise<ConsolidationResult> {
          return { performed: false, tokensChanged: 0, actions: [] };
        }
      }

      StrategyRegistry.register(PluginDependentStrategy);

      const strategy = StrategyRegistry.create('plugin-dependent');
      expect(strategy.requiredPlugins).toEqual(['working_memory', 'custom_plugin']);
    });
  });

  describe('Strategy Removal', () => {
    class RemovableStrategy implements ICompactionStrategy {
      readonly name = 'removable';
      readonly displayName = 'Removable';
      readonly description = 'A removable strategy';
      readonly threshold = 0.75;

      async compact(): Promise<CompactionResult> {
        return { tokensFreed: 0, messagesRemoved: 0, pluginsCompacted: [], log: [] };
      }

      async consolidate(): Promise<ConsolidationResult> {
        return { performed: false, tokensChanged: 0, actions: [] };
      }
    }

    it('should remove custom strategy', () => {
      StrategyRegistry.register(RemovableStrategy);

      expect(StrategyRegistry.has('removable')).toBe(true);

      const removed = StrategyRegistry.remove('removable');
      expect(removed).toBe(true);
      expect(StrategyRegistry.has('removable')).toBe(false);
    });

    it('should return false when removing non-existent strategy', () => {
      const removed = StrategyRegistry.remove('non-existent');
      expect(removed).toBe(false);
    });

    it('should throw when removing built-in strategy', () => {
      expect(() => {
        StrategyRegistry.remove('default');
      }).toThrow(/Cannot remove built-in/);
    });
  });

  describe('Error Handling', () => {
    it('should throw when getting non-existent strategy', () => {
      expect(() => {
        StrategyRegistry.get('non-existent');
      }).toThrow(/not found/);
    });

    it('should throw when creating non-existent strategy', () => {
      expect(() => {
        StrategyRegistry.create('non-existent');
      }).toThrow(/not found/);
    });

    it('should return undefined for getIfExists with non-existent strategy', () => {
      const entry = StrategyRegistry.getIfExists('non-existent');
      expect(entry).toBeUndefined();
    });

    it('should return entry for getIfExists with existing strategy', () => {
      const entry = StrategyRegistry.getIfExists('default');
      expect(entry).toBeDefined();
      expect(entry?.name).toBe('default');
    });
  });
});
