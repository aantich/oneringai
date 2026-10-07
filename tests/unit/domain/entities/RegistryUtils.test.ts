import { describe, expect, it } from 'vitest';
import { assertNoRegistryAliasCollisions } from '@/domain/entities/RegistryUtils.js';

describe('assertNoRegistryAliasCollisions', () => {
  const model = (name: string, aliases?: string[]) => ({
    name,
    provider: 'openai',
    description: name,
    isActive: true,
    aliases,
  }) as any;

  it('rejects an alias that shadows a canonical registry key', () => {
    expect(() => assertNoRegistryAliasCollisions({
      current: model('current', ['legacy']),
      legacy: model('legacy'),
    })).toThrow(/conflicts with canonical key 'legacy'/);
  });

  it('rejects aliases shared by multiple models', () => {
    expect(() => assertNoRegistryAliasCollisions({
      first: model('first', ['latest']),
      second: model('second', ['latest']),
    })).toThrow(/conflicts with model 'first'/);
  });
});
