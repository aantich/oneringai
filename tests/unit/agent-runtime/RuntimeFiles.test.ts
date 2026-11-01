import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RuntimeFileTransfers, readFileResponse } from '@/agent-runtime/RuntimeFileTransfers.js';
import type { AgentDriver, DriverSession } from '@/agent-runtime/AgentDriver.js';
import { Connector, Vendor } from '@/index.js';
import { AgentRuntime, LocalExecutionBackend, FileRuntimeSessionStorage } from '@/agent-runtime/index.js';
import { OpenAIManagedDriver } from '@/agent-runtime/openai-managed.js';
import { ClaudeManagedDriver } from '@/agent-runtime/claude-managed.js';
import { openAIManagedFixture } from '../../../examples/agent-runtime/openai-managed-fixture.js';
import { claudeManagedFixture } from '../../../examples/agent-runtime/claude-managed-fixture.js';

const directories: string[] = [];
async function directory() { const root = await mkdtemp(path.join(tmpdir(), 'runtime-files-')); directories.push(root); return root; }
afterEach(async () => { Connector.clear(); await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const denied = { filesystem: 'denied', commands: 'denied', sandboxNetwork: 'denied', providerWebSearch: 'denied', approvals: 'deny' } as const;

describe('explicit runtime file boundary', () => {
  it('rejects traversal, source/destination symlinks, oversize and disallowed MIME before native I/O', async () => {
    const root = await directory(); await mkdir(path.join(root, 'inside')); await writeFile(path.join(root, 'source.txt'), 'ACK');
    await symlink(path.join(root, 'source.txt'), path.join(root, 'link.txt')); await symlink(path.join(root, 'inside'), path.join(root, 'alias'));
    let calls = 0;
    const native = { uploadFile: async () => { calls++; return { type: 'reference', name: 'x', reference: 'x' }; }, downloadArtifact: async () => { calls++; return new Response('ACK', { headers: { 'Content-Type': 'text/plain' } }); } } as unknown as DriverSession;
    const files = new RuntimeFileTransfers(() => ({ root, maxBytes: 3, mediaTypes: ['text/plain'] }), native);
    for (const name of ['../source.txt', '/etc/passwd', 'alias/x.txt', 'a/../source.txt', 'link.txt']) await expect(files.upload({ path: name, mediaType: 'text/plain' })).rejects.toThrow();
    await expect(files.upload({ path: 'source.txt', mediaType: 'application/json' })).rejects.toThrow('MIME');
    await writeFile(path.join(root, 'large.txt'), 'large'); await expect(files.upload({ path: 'large.txt', mediaType: 'text/plain' })).rejects.toThrow('byte');
    await expect(files.download({ path: 'link.txt', reference: 'x' })).rejects.toThrow();
    expect(calls).toBe(0);
    await files.upload({ path: 'source.txt', mediaType: 'text/plain' }); expect(calls).toBe(1);
    const result = await files.download({ path: 'answer.txt', reference: 'x' }); expect(result.bytes).toBe(3); expect(await readFile(result.path, 'utf8')).toBe('ACK');
    await expect(files.download({ path: 'answer.txt', reference: 'x' })).rejects.toThrow();
  });
  it('bounds unknown-length streams, rejects redirects and removes partial downloads', async () => {
    const limits = { maxBytes: 3, mediaTypes: ['text/plain'] };
    await expect(readFileResponse(new Response('oversize', { headers: { 'Content-Type': 'text/plain' } }), limits)).rejects.toThrow('byte');
    await expect(readFileResponse(new Response('', { status: 302, headers: { 'Content-Type': 'text/plain', Location: 'https://foreign.invalid' } }), limits)).rejects.toThrow('redirect');
    const root = await directory(); const files = new RuntimeFileTransfers(() => ({ root, ...limits }), { downloadArtifact: async () => new Response('large', { headers: { 'Content-Type': 'text/plain' } }) } as DriverSession);
    await expect(files.download({ reference: 'x', path: 'partial.txt' })).rejects.toThrow('byte'); await expect(access(path.join(root, 'partial.txt'))).rejects.toThrow();
  });
  it.each([['openai', false], ['openai', true], ['claude', false], ['claude', true]] as const)('uses actual %s SDK transfer endpoints, upload loss=%s', async (vendor, lostUpload) => {
    const root = await directory(); await writeFile(path.join(root, 'input.txt'), 'ACK');
    const openai = openAIManagedFixture({ artifacts: true, dropInlineUpload: lostUpload }); const claude = claudeManagedFixture({ artifacts: true, dropFileUpload: lostUpload });
    Connector.create({ name: 'files', vendor: vendor === 'openai' ? Vendor.OpenAI : Vendor.Anthropic, auth: { type: 'api_key', apiKey: 'offline' } });
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ sessionStorage: new FileRuntimeSessionStorage(path.join(root, 'control')), fileTransfer: () => ({ root, mediaTypes: ['text/plain'], maxBytes: 16 }), drivers: [vendor === 'openai' ? new OpenAIManagedDriver({ createClient: openai.createClient }) : new ClaudeManagedDriver({ createClient: claude.createClient })], resolveTools: () => ({ fingerprint: 'probe-v1', tools: [{ definition: { type: 'function', function: { name: 'probe', parameters: { type: 'object', properties: {} } } }, execute: async () => ({ businessValue: 'original' }) }] }) }) });
    try {
      const agent = runtime.createAgent({ id: 'files', instructions: 'Use probe', tools: ['probe'] });
      const session = await agent.openSession({ execution: { driver: vendor === 'openai' ? 'openai.agents.api' : 'anthropic.managed.api', connector: 'files', model: vendor === 'openai' ? 'gpt-6-astra' : 'claude-sonnet-4-6' }, context: { userId: 'owner' }, environment: { type: 'provider-managed' }, policy: vendor === 'openai' ? { ...denied, filesystem: 'workspace-write', commands: 'sandboxed' } : denied });
      const result = await (await session.run('task')).result; expect(result.status).toBe('completed');
      const artifact = result.artifacts.find(item => item.type === 'reference'); expect(artifact?.type).toBe('reference');
      if (artifact?.type !== 'reference') throw new Error('Missing artifact');
      const downloaded = await session.downloadArtifact({ reference: artifact.reference, path: 'answer.txt' }); expect(await readFile(downloaded.path, 'utf8')).toBe('ACK');
      await expect(session.downloadArtifact({ reference: artifact.reference.replace('native-session', 'foreign'), path: 'foreign.txt' })).rejects.toThrow('Foreign');
      if (lostUpload) {
        await expect(session.uploadFile({ path: 'input.txt', mediaType: 'text/plain' })).rejects.toThrow();
        expect((await session.inspectState()).unresolvedEffects).toBe(true);
        await expect(session.run('must not submit')).rejects.toThrow('reconciliation');
        await runtime.deleteSession(session.reference(), { context: { userId: 'owner' } });
        return;
      }
      const uploaded = await session.uploadFile({ path: 'input.txt', mediaType: 'text/plain' }); expect(uploaded.type).toBe('reference');
      // Native resources stay valid after authorized mount registration.
      expect((await (await session.run('continue')).result).status).toBe('completed');
      await runtime.deleteSession(session.reference(), { context: { userId: 'owner' } });
    } finally { await runtime.destroy(); }
  });
  it.each(['continue', 'destroy', 'cancel'] as const)('excludes transfers/detach during asynchronous run admission, mode=%s', async mode => {
    const root = await directory(); await writeFile(path.join(root, 'input.txt'), 'ACK'); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    let inputs = 0; let uploads = 0; let destroyed = false;
    Connector.create({ name: 'admission', vendor: Vendor.OpenAI, auth: { type: 'none' } });
    const driver: AgentDriver = { id: 'gated', inspect: async () => ({ capabilities: { driverId: 'gated', capabilities: { 'agent.definition': { id: 'agent.definition', support: 'native' }, 'files.upload': { id: 'files.upload', support: 'native' } } } }), openSession: async () => ({
      get isDestroyed() { return destroyed; }, destroy: async () => { destroyed = true; }, cancelActiveRun: async () => {}, detach: async () => {},
      inspectState: async () => { await gate; return { connection: 'attached', activity: 'ready', unresolvedEffects: false }; },
      uploadFile: async file => { uploads++; return { type: 'reference', reference: 'native-file', name: file.name }; },
      run: async () => { inputs++; return { events: (async function* () {})(), result: Promise.resolve({ status: 'completed', outputText: 'ACK' }), cancel: async () => {} }; },
    }) };
    const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [driver], fileTransfer: () => ({ root, mediaTypes: ['text/plain'] }) }) });
    try {
      const session = await runtime.createAgent({ id: 'gated', instructions: '' }).openSession({ execution: { driver: 'gated', connector: 'admission', model: 'fixture' }, context: {}, policy: denied });
      const pending = session.run('work', { requestId: 'one' }); void pending.catch(() => undefined);
      await expect(session.uploadFile({ path: 'input.txt', mediaType: 'text/plain' })).rejects.toThrow('idle');
      await expect(session.detach()).rejects.toThrow('admission'); expect(uploads).toBe(0);
      if (mode === 'destroy') { const closed = session.destroy(); release(); await closed; await expect(pending).rejects.toThrow('closed'); expect(inputs).toBe(0); }
      else if (mode === 'cancel') { await session.cancelActiveRun('cancel admission'); release(); await expect(pending).rejects.toThrow('cancel admission'); expect(inputs).toBe(0); }
      else { release(); await (await pending).result; await session.uploadFile({ path: 'input.txt', mediaType: 'text/plain' }); expect(inputs).toBe(1); expect(uploads).toBe(1); }
    } finally { release(); await runtime.destroy(); }
  });
  it('refuses expired native files and recovers an uncertain upload without creating another file', async () => {
    const root = await directory(); await writeFile(path.join(root, 'input.txt'), 'ACK');
    const wire = claudeManagedFixture({ artifacts: true, expiredFile: true, dropFileUpload: true });
    Connector.create({ name: 'files', vendor: Vendor.Anthropic, auth: { type: 'api_key', apiKey: 'offline' } });
    const make = () => new AgentRuntime({ backend: new LocalExecutionBackend({ sessionStorage: new FileRuntimeSessionStorage(path.join(root, 'control')), fileTransfer: () => ({ root, mediaTypes: ['text/plain'] }), drivers: [new ClaudeManagedDriver({ createClient: wire.createClient })] }) });
    const runtime = make(); const options = { execution: { driver: 'anthropic.managed.api', connector: 'files', model: 'claude-sonnet-4-6' }, context: { userId: 'owner' }, environment: { type: 'provider-managed' as const }, policy: denied };
    try {
      const session = await runtime.createAgent({ id: 'files', instructions: 'text only' }).openSession(options);
      await expect(session.downloadArtifact({ reference: 'claude-file:native-session:native-file', path: 'expired.txt' })).rejects.toThrow('expired');
      await expect(session.uploadFile({ path: 'input.txt', mediaType: 'text/plain' })).rejects.toThrow();
      const reference = session.reference(); await session.detach(); const restored = await runtime.resumeSession(reference, { context: options.context });
      expect((await restored.inspectState()).unresolvedEffects).toBe(true);
      await expect(restored.run('do not submit')).rejects.toThrow('reconciliation');
      await runtime.deleteSession(reference, { context: options.context });
      expect(wire.requests.filter(request => request.path === '/v1/files' && request.method === 'POST')).toHaveLength(1);
    } finally { await runtime.destroy(); }
  });
});
