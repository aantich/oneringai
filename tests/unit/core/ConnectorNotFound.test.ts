import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connector } from '@/core/Connector.js';
import { ScopedConnectorRegistry } from '@/core/ScopedConnectorRegistry.js';
import { AgentContextNextGen } from '@/core/context-nextgen/AgentContextNextGen.js';
import { AIError, ConnectorNotFoundError, ProviderAuthError } from '@/domain/errors/AIErrors.js';
import { ConnectorEmbedder } from '@/memory/integration/ConnectorEmbedder.js';

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('Expected lookup to fail');
}

describe('ConnectorNotFoundError', () => {
  beforeEach(() => {
    Connector.setRegistry(null);
    Connector.clear();
  });

  afterEach(() => {
    Connector.setRegistry(null);
    Connector.clear();
    vi.restoreAllMocks();
  });

  it('provides a stable classification without prescribing HTTP or fallback behavior', () => {
    const error = new ConnectorNotFoundError();
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AIError);
    expect(error).toBeInstanceOf(ConnectorNotFoundError);
    expect(error.name).toBe('ConnectorNotFoundError');
    expect(error.code).toBe('CONNECTOR_NOT_FOUND');
    expect(error.statusCode).toBeUndefined();
    expect(error.message).toBe('Connector not found in current scope.');
    expect(JSON.parse(JSON.stringify(error)).code).toBe('CONNECTOR_NOT_FOUND');
    const cause = new Error('Host lookup diagnostic');
    const wrapped = new ConnectorNotFoundError('Connector unavailable in this scope.', cause);
    expect(wrapped.originalError).toBe(cause);
    expect(wrapped.message).toBe('Connector unavailable in this scope.');
  });

  it('classifies built-in name and ID misses while preserving existing diagnostics', () => {
    Connector.create({ name: 'visible', auth: { type: 'api_key', apiKey: 'fixture' } });
    const byName = caught(() => Connector.get('missing'));
    expect(byName).toBeInstanceOf(ConnectorNotFoundError);
    expect(byName).toMatchObject({
      code: 'CONNECTOR_NOT_FOUND',
      message: "Connector 'missing' not found. Available: visible",
    });
    const byId = caught(() => Connector.asRegistry().getById!('missing-id'));
    expect(byId).toBeInstanceOf(ConnectorNotFoundError);
    expect(byId).toMatchObject({
      code: 'CONNECTOR_NOT_FOUND',
      message: "Connector with id 'missing-id' not found",
    });
  });

  it('keeps missing and hidden name lookups indistinguishable without disclosing other connectors', () => {
    Connector.create({ name: 'visible', auth: { type: 'api_key', apiKey: 'fixture' } });
    const hidden = Connector.create({ name: 'hidden', auth: { type: 'api_key', apiKey: 'fixture' } });
    Connector.create({ name: 'other-secret', auth: { type: 'api_key', apiKey: 'fixture' } });
    const registry = new ScopedConnectorRegistry({ canAccess: (c) => c.name === 'visible' }, {});
    const denied = caught(() => registry.get('hidden'));
    const deniedId = caught(() => registry.getById(hidden.id));
    expect(denied).toBeInstanceOf(ConnectorNotFoundError);
    expect(deniedId).toBeInstanceOf(ConnectorNotFoundError);
    expect((denied as Error).message).not.toContain('other-secret');
    expect((deniedId as Error).message).not.toContain('other-secret');
    Connector.remove('hidden');
    const missing = caught(() => registry.get('hidden'));
    expect(missing).toBeInstanceOf(ConnectorNotFoundError);
    expect((missing as Error).message).toBe((denied as Error).message);
    expect(caught(() => registry.getById(hidden.id))).toBeInstanceOf(ConnectorNotFoundError);
    expect(registry.get('visible').name).toBe('visible');
  });

  it('preserves explicit access-policy failures instead of converting them to absence', () => {
    Connector.create({ name: 'visible', auth: { type: 'api_key', apiKey: 'fixture' } });
    const failure = new ProviderAuthError('fixture');
    const registry = new ScopedConnectorRegistry({ canAccess: () => { throw failure; } }, {});
    expect(caught(() => registry.get('visible'))).toBe(failure);
  });

  it.each([
    ['missing', new ConnectorNotFoundError()],
    ['auth', new ProviderAuthError('fixture')],
    ['storage', new Error('Storage unavailable')],
    ['configuration', new Error('Configured connector cannot decrypt')],
    ['untyped legacy miss', new Error("Connector 'missing' not found")],
  ])('propagates custom registry %s errors unchanged for names and IDs', (_kind, failure) => {
    Connector.setRegistry({
      ...Connector.asRegistry(),
      get: () => { throw failure; },
      getById: () => { throw failure; },
    });
    expect(caught(() => Connector.get('missing'))).toBe(failure);
    expect(caught(() => Connector.getById('missing-id'))).toBe(failure);
  });

  it('retains the classification through memory embedding initialization without provider calls', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Provider must not be called');
    });
    const error = caught(() => new ConnectorEmbedder({
      connector: 'missing', model: 'text-embedding-3-small', dimensions: 1536,
    }));
    expect(error).toBeInstanceOf(ConnectorNotFoundError);
    expect(error).toMatchObject({ code: 'CONNECTOR_NOT_FOUND' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the shared error for connectors hidden by agent identities', () => {
    Connector.create({ name: 'visible', auth: { type: 'api_key', apiKey: 'fixture' } });
    Connector.create({ name: 'hidden', auth: { type: 'api_key', apiKey: 'fixture' } });
    const context = AgentContextNextGen.create({
      model: 'gpt-4', identities: [{ connector: 'visible' }],
    });
    try {
      const registry = context.tools.getToolContext()!.connectorRegistry!;
      expect(caught(() => registry.get('hidden'))).toBeInstanceOf(ConnectorNotFoundError);
      expect(registry.get('visible').name).toBe('visible');
      expect(registry.list()).toEqual(['visible']);
    } finally {
      context.destroy();
    }
  });
});
