import { describe, expect, it, vi } from 'vitest';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { runtimeTokenProvider } from '@/agent-runtime/internal.js';
import { managedFetch } from '@/agent-runtime/ManagedTransport.js';

describe('managed connector transport boundary', () => {
  it('pins origin before forwarding credentials and disables redirects', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('ok'));
    const guarded = managedFetch(fetcher, 'https://provider.example/v1');
    await expect(guarded('https://foreign.example/v1/files', { headers: { Authorization: 'Bearer secret' } })).rejects.toThrow('origin'); expect(fetcher).not.toHaveBeenCalled();
    await expect(guarded('https://user:password@provider.example/v1')).rejects.toThrow('origin');
    await guarded('https://provider.example/v1/files'); expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
  });
  it('refreshes a replaced authorized connector and rejects revocation or endpoint substitution', async () => {
    const create = (apiKey: string, baseURL = 'https://provider.example') => Connector.create({ name: 'managed-token-test', vendor: Vendor.OpenAI, baseURL, auth: { type: 'api_key', apiKey } });
    create('first'); const token = runtimeTokenProvider({ get: name => Connector.get(name) }, 'managed-token-test');
    try {
      expect(await token()).toBe('first'); Connector.remove('managed-token-test'); create('rotated'); expect(await token()).toBe('rotated');
      Connector.remove('managed-token-test'); await expect(token()).rejects.toThrow();
      create('foreign-key', 'https://foreign.example'); await expect(token()).rejects.toThrow('endpoint/account');
    } finally { Connector.remove('managed-token-test'); }
  });
  it('suppresses reflected credentials and transport causes without losing native HTTP status', async () => {
    const guarded = managedFetch(async () => new Response(JSON.stringify({ error: { message: 'REFLECTED_API_KEY' } }), { status: 404 }), 'https://provider.example');
    const response = await guarded('https://provider.example/file'); expect(response.status).toBe(404); expect(await response.text()).not.toContain('REFLECTED_API_KEY');
    await expect(managedFetch(async () => { throw new Error('SECRET_TRANSPORT_CAUSE'); }, 'https://provider.example')('https://provider.example')).rejects.toThrow('acceptance must be reconciled');
    await expect(managedFetch(async () => new Response(null, { status: 302, headers: { Location: 'https://foreign.example' } }), 'https://provider.example')('https://provider.example')).rejects.toThrow('redirects');
  });
});
