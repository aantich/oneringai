import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileRuntimeSessionStorage, InMemoryRuntimeSessionStorage, RuntimeControl } from '@/agent-runtime/RuntimeSessionStorage.js';

for (const kind of ['memory','file'] as const) describe(`${kind} runtime control storage`, () => {
  it('requires an exclusive writer, checks revisions, scopes and releases ownership', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'runtime-storage-'));
    try {
      const storage = kind === 'file' ? new FileRuntimeSessionStorage(directory) : new InMemoryRuntimeSessionStorage();
      const lease = await storage.acquire('session_test', { userId: 'one' });
      const record = await lease.write({ state: 'ready' }, 0); expect(record.revision).toBe(1);
      await expect(lease.write({}, 0)).rejects.toThrow('revision');
      await expect(storage.acquire('session_test', { userId: 'one' })).rejects.toThrow('writer');
      const foreign = await storage.acquire('session_test', { userId: 'two' }); expect(await foreign.read()).toBeUndefined(); await foreign.release();
      await lease.release(); await expect(lease.read()).rejects.toThrow('released');
      const restored = await storage.acquire('session_test', { userId: 'one' }); expect((await restored.read())?.data.state).toBe('ready'); await restored.delete(); await restored.release();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
describe('file storage bounds and acknowledged result outbox', () => {
  it('rejects path identities and oversized records without replacing committed state', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'runtime-storage-'));
    try {
      const storage = new FileRuntimeSessionStorage(directory, 1024);
      await expect(storage.acquire('../escape', {})).rejects.toThrow('reference');
      const lease = await storage.acquire('session_bounds', {}); await lease.write({ original: true }, 0);
      await expect(lease.write({ tooLarge: 'x'.repeat(2000) }, 1)).rejects.toThrow('bound'); expect((await lease.read())?.revision).toBe(1); await lease.release();
      await writeFile(path.join(directory, 'unrelated'), 'unchanged');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('does not repeat an interrupted external action and redelivers acknowledged results', async () => {
    const storage = new InMemoryRuntimeSessionStorage(); const lease = await storage.acquire('session_outbox', {});
    const initial = await lease.write({ outbox: { interrupted: { state: 'executing' } } }, 0); const control = new RuntimeControl(lease, initial);
    let calls = 0;
    const action = async () => { calls++; return { result: 'original' }; };
    await expect(control.outbox('interrupted', action)).rejects.toThrow('never repeat'); expect(calls).toBe(0);
    expect(await control.outbox('new', action)).toEqual({ result: 'original' });
    expect(await control.outbox('new', action)).toEqual({ result: 'original' }); expect(calls).toBe(1); await control.release();
  });
});

describe('outbox failure and concurrency boundaries', () => {
  it('shares one admitted action under concurrency and rejects a conflicting native call ID', async () => {
    const storage = new InMemoryRuntimeSessionStorage(); const lease = await storage.acquire('session_parallel', {});
    const control = new RuntimeControl(lease, await lease.write({ outbox: {} }, 0));
    let calls = 0; let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const action = async () => { calls++; await wait; return { result: 'one' }; };
    const first = control.outbox('call', action, 'payload-v1'); const second = control.outbox('call', action, 'payload-v1');
    await expect(control.outbox('call', action, 'conflict')).rejects.toThrow('conflict');
    release(); expect(await first).toEqual(await second); expect(calls).toBe(1); await control.release();
  });
  it('retains a settled observation across a failed acknowledgement without repeating its action', async () => {
    const storage = new InMemoryRuntimeSessionStorage(); const base = await storage.acquire('session_retry_store', {});
    let fail = true;
    const lease = { ...base, write: async (data: import('@/agent-runtime/types.js').JsonObject, revision: number) => {
      if (fail && (data.outbox as { call?: { state?: string } })?.call?.state === 'settled') throw new Error('storage full');
      return base.write(data, revision);
    } };
    const control = new RuntimeControl(lease, await lease.write({ outbox: {} }, 0)); let calls = 0;
    const action = async () => { calls++; return { result: 'retained-original' }; };
    await expect(control.outbox('call', action)).rejects.toThrow('storage full');
    fail = false; expect(await control.outbox('call', action)).toEqual({ result: 'retained-original' }); expect(calls).toBe(1); await control.release();
  });
});
