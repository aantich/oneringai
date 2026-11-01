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
  it.each(['before', 'after'] as const)('repairs a %s-commit settlement failure without repeating the external action', async failure => {
    const storage = new InMemoryRuntimeSessionStorage(); const base = await storage.acquire('session_ambiguous', {});
    let fail = true; let writes = 0;
    const lease = { ...base, write: async (data: import('@/agent-runtime/types.js').JsonObject, revision: number) => {
      writes++;
      const settlement = (data.outbox as { call?: { state?: string } })?.call?.state === 'settled';
      if (fail && settlement && failure === 'before') throw new Error('acknowledgement lost');
      const record = await base.write(data, revision);
      if (fail && settlement) throw new Error('acknowledgement lost');
      return record;
    } };
    const control = new RuntimeControl(lease, await lease.write({ outbox: {} }, 0)); let calls = 0;
    const action = async () => { calls++; return { result: 'original' }; };
    try {
      await expect(control.outbox('call', action, 'original-payload')).rejects.toThrow('acknowledgement lost');
      fail = false;
      expect(await control.outbox('call', action, 'original-payload')).toEqual({ result: 'original' });
      expect(calls).toBe(1); expect(writes).toBeGreaterThanOrEqual(4);
      await control.update(data => { data.checkpoint = 'after repair'; });
      expect((await base.read())?.data.checkpoint).toBe('after repair');
    } finally { await control.release(); }
  });
  it('requires a new acknowledged write even after repeated post-commit failures', async () => {
    const base = await new InMemoryRuntimeSessionStorage().acquire('session_repeated', {});
    const initial = await base.write({ value: 0 }, 0); let remainingFailures = 2;
    const control = new RuntimeControl({ ...base, write: async (data, revision) => {
      const record = await base.write(data, revision);
      if (remainingFailures-- > 0) throw new Error('post-commit fsync failure');
      return record;
    } }, initial);
    try {
      await expect(control.update(data => { data.value = 1; })).rejects.toThrow('fsync');
      await expect(control.update(data => { data.value = 2; })).rejects.toThrow('fsync');
      expect(control.data.value).toBe(0); expect((await base.read())?.data.value).toBe(1);
      await control.update(data => { data.value = 3; });
      expect(control.data.value).toBe(3); expect((await base.read())?.revision).toBe(5);
    } finally { await control.release(); }
  });
  it('does not overwrite a conflicting record or retroactively admit a failed pre-commit intent', async () => {
    const base = await new InMemoryRuntimeSessionStorage().acquire('session_conflict', {});
    const initial = await base.write({ value: 0 }, 0); let fail = true;
    const control = new RuntimeControl({ ...base, write: async (data, revision) => {
      if (fail) throw new Error('before commit'); return base.write(data, revision);
    } }, initial);
    try {
      await expect(control.update(data => { data.failedAdmission = true; })).rejects.toThrow('before commit');
      fail = false; await control.update(data => { data.value = 1; });
      expect(control.data).toEqual({ value: 1 });
      fail = true; await expect(control.update(data => { data.value = 2; })).rejects.toThrow('before commit');
      const current = (await base.read())!; await base.write({ value: 'conflicting' }, current.revision);
      fail = false;
      await expect(control.update(data => { data.value = 3; })).rejects.toThrow('cannot be reconciled');
      expect((await base.read())?.data.value).toBe('conflicting');
    } finally { await control.release(); }
  });
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
