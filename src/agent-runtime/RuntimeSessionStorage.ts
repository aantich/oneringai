import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, rename, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { hostname } from 'node:os';
import type { JsonObject, JsonValue, TrustedRuntimeContext } from './types.js';
import { AgentBusyError, AgentDriverConfigurationError } from './errors.js';
import { contentDigest, cloneAndFreezeJson } from './internal.js';

/** Acknowledged control snapshots, separate from tool evidence and token activity. */
export interface RuntimeSessionRecord { version: 1; id: string; revision: number; scope: string; data: JsonObject }
export interface RuntimeSessionLease {
  read(): Promise<RuntimeSessionRecord | undefined>;
  /** expectedRevision is 0 for creation. Revision conflicts never overwrite another writer. */
  write(data: JsonObject, expectedRevision: number): Promise<RuntimeSessionRecord>;
  delete(): Promise<void>;
  release(): Promise<void>;
}
export interface IRuntimeSessionStorage {
  readonly durability: 'process' | 'durable';
  acquire(id: string, context: TrustedRuntimeContext): Promise<RuntimeSessionLease>;
}
export function runtimeScope(context: TrustedRuntimeContext): string {
  return createHash('sha256').update(JSON.stringify([context.tenantId ?? null, context.userId ?? null, context.groupId ?? null])).digest('hex');
}
export class InMemoryRuntimeSessionStorage implements IRuntimeSessionStorage {
  readonly durability = 'process';
  constructor(private readonly maxRecordBytes = 4 * 1024 * 1024) {}
  private readonly records = new Map<string, RuntimeSessionRecord>();
  private readonly locks = new Set<string>();
  async acquire(id: string, context: TrustedRuntimeContext): Promise<RuntimeSessionLease> {
    const key = `${runtimeScope(context)}:${id}`;
    if (this.locks.has(key)) throw new AgentBusyError('Runtime session already has a writer');
    this.locks.add(key); let released = false;
    const check = () => { if (released) throw new AgentBusyError('Runtime session lease is released'); };
    return {
      read: async () => { check(); const record = this.records.get(key); return record ? cloneAndFreezeJson(record, 'Runtime record') : undefined; },
      write: async (data, expectedRevision) => {
        check(); if ((this.records.get(key)?.revision ?? 0) !== expectedRevision) throw new AgentBusyError('Runtime session revision conflict');
        if (Buffer.byteLength(JSON.stringify(data)) > this.maxRecordBytes) throw new AgentDriverConfigurationError('Runtime record exceeds storage bound');
        const record = cloneAndFreezeJson({ version: 1 as const, id, revision: expectedRevision + 1, scope: runtimeScope(context), data }, 'Runtime record');
        this.records.set(key, record); return record;
      },
      delete: async () => { check(); this.records.delete(key); },
      release: async () => { if (!released) { released = true; this.locks.delete(key); } },
    };
  }
}

/** Single-host exclusive writer, atomic rename and acknowledged file+directory fsync. */
export class FileRuntimeSessionStorage implements IRuntimeSessionStorage {
  readonly durability = 'durable';
  constructor(private readonly directory: string, private readonly maxRecordBytes = 4 * 1024 * 1024) {
    if (process.platform === 'win32') throw new AgentDriverConfigurationError('FileRuntimeSessionStorage requires POSIX directory fsync; supply an acknowledged Windows storage adapter');
    if (!Number.isSafeInteger(maxRecordBytes) || maxRecordBytes < 1024) throw new AgentDriverConfigurationError('Runtime storage maxRecordBytes must be at least 1024');
  }
  async acquire(id: string, context: TrustedRuntimeContext): Promise<RuntimeSessionLease> {
    if (typeof id !== 'string' || !/^session_[a-zA-Z0-9-]+$/.test(id)) throw new AgentDriverConfigurationError('Invalid runtime session reference');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const root = await realpath(this.directory);
    const scope = runtimeScope(context);
    const key = createHash('sha256').update(`${scope}:${id}`).digest('hex');
    const filename = path.join(root, `${key}.json`); const lock = path.join(root, `${key}.lock`);
    const nonce = randomUUID();
    const claim = async () => {
      const handle = await open(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), nonce })); await handle.sync(); } finally { await handle.close(); }
    };
    try { await claim(); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const owner = JSON.parse(await readFile(lock, 'utf8')) as { pid: number; host: string; nonce: string };
      if (owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new AgentBusyError('Runtime writer cannot be proven stale');
      let dead = false;
      try { process.kill(owner.pid, 0); } catch (failure) { dead = (failure as NodeJS.ErrnoException).code === 'ESRCH'; }
      if (!dead) throw new AgentBusyError('Runtime session already has a live writer');
      // Rename the stale lock to an exclusive tombstone; concurrent claimants fail closed.
      const tombstone = `${lock}.stale`;
      let gate;
      try { gate = await open(tombstone, 'wx', 0o600); }
      catch { throw new AgentBusyError('Another host is reclaiming this writer'); }
      try {
        const current = JSON.parse(await readFile(lock, 'utf8')) as { nonce: string };
        if (current.nonce !== owner.nonce) throw new AgentBusyError('Runtime writer changed during recovery');
        await rm(lock); await claim();
      } finally { await gate.close(); await rm(tombstone, { force: true }); }
    }
    let released = false;
    const check = async () => {
      if (released) throw new AgentBusyError('Runtime session lease is released');
      const owner = JSON.parse(await readFile(lock, 'utf8')) as { nonce: string };
      if (owner.nonce !== nonce) throw new AgentBusyError('Runtime session writer ownership lost');
    };
    const read = async (): Promise<RuntimeSessionRecord | undefined> => {
      await check(); let file;
      try { file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
      try {
        if ((await file.stat()).size > this.maxRecordBytes) throw new AgentDriverConfigurationError('Runtime record exceeds storage bound');
        const record = JSON.parse(await file.readFile('utf8')) as RuntimeSessionRecord;
        if (record.version !== 1 || record.id !== id || record.scope !== scope || !Number.isSafeInteger(record.revision) || record.revision < 1) throw new AgentDriverConfigurationError('Invalid or foreign runtime record');
        return cloneAndFreezeJson(record, 'Runtime record');
      } finally { await file.close(); }
    };
    return {
      read,
      write: async (data, expectedRevision) => {
        await check(); if (((await read())?.revision ?? 0) !== expectedRevision) throw new AgentBusyError('Runtime session revision conflict');
        const record: RuntimeSessionRecord = { version: 1, id, scope, revision: expectedRevision + 1, data: cloneAndFreezeJson(data, 'Runtime control data') };
        const encoded = JSON.stringify(record);
        if (Buffer.byteLength(encoded) > this.maxRecordBytes) throw new AgentDriverConfigurationError('Runtime record exceeds storage bound');
        const temporary = `${filename}.${nonce}.tmp`;
        const handle = await open(temporary, 'wx', 0o600);
        try {
          try { await handle.writeFile(encoded); await handle.sync(); } finally { await handle.close(); }
          await check(); await rename(temporary, filename); const directory = await open(root, 'r'); try { await directory.sync(); } finally { await directory.close(); }
        } finally { await rm(temporary, { force: true }); }
        return record;
      },
      delete: async () => { await check(); await rm(filename, { force: true }); const directory = await open(root, 'r'); try { await directory.sync(); } finally { await directory.close(); } },
      release: async () => { if (!released) { await check(); await rm(lock); released = true; } },
    };
  }
}

/** One serialized writer shared by admission, checkpoints and the tool-result outbox. */
export class RuntimeControl {
  private tail: Promise<unknown> = Promise.resolve();
  private pendingWrite?: { before: RuntimeSessionRecord; data: JsonObject; acknowledgementRequired: boolean };
  private readonly invocations = new Map<string, { digest: string; promise: Promise<JsonObject> }>();
  private readonly retainedReports = new Map<string, JsonObject>();
  constructor(readonly lease: RuntimeSessionLease, private record: RuntimeSessionRecord) {}
  get data(): JsonObject { return structuredClone(this.record.data); }
  update(change: (data: JsonObject) => void): Promise<void> {
    return this.serialize(async () => {
      await this.reconcileWrite();
      const data = this.data; change(data);
      const candidate = controlJson(data);
      this.pendingWrite = { before: this.record, data: candidate, acknowledgementRequired: false };
      this.record = await this.lease.write(candidate, this.record.revision);
      this.pendingWrite = undefined;
    });
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.tail.then(action);
    this.tail = operation.catch(() => undefined);
    return operation;
  }
  private async reconcileWrite(): Promise<void> {
    const pending = this.pendingWrite;
    if (!pending) return;
    const current = await this.lease.read();
    if (current && contentDigest(current) === contentDigest(pending.before)) {
      // A failed pre-commit write did not advance storage. Do not retroactively
      // admit an action whose caller already received a failure.
      if (!pending.acknowledgementRequired) { this.pendingWrite = undefined; return; }
    } else if (!current || current.id !== pending.before.id || current.scope !== pending.before.scope
      || current.version !== pending.before.version || current.revision !== pending.before.revision + 1
      || contentDigest(current.data) !== contentDigest(pending.data)) {
      throw new AgentBusyError('Runtime control write cannot be reconciled with its original intent');
    }
    // Seeing the candidate is not a durability acknowledgement. Rewrite it under
    // the same exclusive lease and require a successful storage acknowledgement.
    // Retain the new expected revision even if this acknowledgement also fails.
    this.pendingWrite = { before: current!, data: pending.data, acknowledgementRequired: true };
    this.record = await this.lease.write(pending.data, current!.revision);
    this.pendingWrite = undefined;
  }
  async release(): Promise<void> { await this.tail; await this.lease.release(); }
  async delete(): Promise<void> { await this.tail; await this.lease.delete(); await this.lease.release(); }
  outbox(callId: string, action: () => Promise<JsonObject>, digest = '', recover?: (originalCall?: JsonObject) => Promise<JsonObject | undefined>, admission?: JsonObject): Promise<JsonObject> {
    const active = this.invocations.get(callId);
    if (active) return active.digest === digest ? active.promise : Promise.reject(new AgentDriverConfigurationError('Native call ID conflict'));
    const operation = (async () => {
      await this.serialize(() => this.reconcileWrite());
      const prior = (this.data.outbox as JsonObject | undefined)?.[callId] as JsonObject | undefined;
      if (prior?.digest !== undefined && prior.digest !== digest && (!prior.call || !admission || contentDigest({ name: (prior.call as JsonObject).name, args: (prior.call as JsonObject).args }) !== contentDigest({ name: admission.name, args: admission.args }))) throw new AgentDriverConfigurationError('Native tool call ID was reused with different arguments');
      if (prior) {
        const saved = prior.report as JsonObject | undefined;
        if (prior.state === 'settled' && (saved?.outcome as JsonObject | undefined)?.completion !== 'unknown') return saved!;
        const reconciled = this.retainedReports.get(callId) ?? await recover?.(prior.call as JsonObject | undefined);
        if (!reconciled) throw new AgentBusyError(`Tool call '${callId}' has an unresolved external effect; reconcile its original receipt, never repeat it`);
        await this.update(data => { (data.outbox as JsonObject)[callId] = { ...prior, state: 'settled', digest, report: reconciled }; });
        this.retainedReports.delete(callId);
        return reconciled;
      }
      await this.update(data => { data.outbox ??= {}; (data.outbox as JsonObject)[callId] = { state: 'executing', digest, ...(admission ? { call: admission } : {}) }; });
      const report = await action();
      this.retainedReports.set(callId, report);
      await this.update(data => {
        const latest = (data.outbox as JsonObject)[callId] as JsonObject;
        if (latest.state !== 'settled') (data.outbox as JsonObject)[callId] = { state: 'settled', digest, report, ...(admission ? { call: admission } : {}) };
      });
      this.retainedReports.delete(callId);
      return ((this.data.outbox as JsonObject)[callId] as JsonObject).report as JsonObject;
    })();
    this.invocations.set(callId, { digest, promise: operation });
    void operation.finally(() => this.invocations.delete(callId)).catch(() => undefined);
    return operation;
  }

}

export function controlJson(value: unknown): JsonObject {
  return cloneAndFreezeJson(value, 'Runtime control snapshot') as JsonObject;
}
export function controlValue(value: unknown): JsonValue {
  return cloneAndFreezeJson(value, 'Runtime control value') as JsonValue;
}
