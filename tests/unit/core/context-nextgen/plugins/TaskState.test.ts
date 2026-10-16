import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskStatePluginNextGen, AgentContextNextGen, MemorySystem, InMemoryAdapter, ToolManager } from '../../../../../src/index.js';
import type { TaskStateNoteInput, ToolExecutionOutcome, TaskStatePluginConfig } from '../../../../../src/index.js';
const scope = { ownerId: 'alice', namespace: 'task-tests', tenantId: 'tenant-a' };
const plugins: TaskStatePluginNextGen[] = [];
const plugin = (config: Partial<TaskStatePluginConfig> = {}) => { const p = new TaskStatePluginNextGen({ scope, taskId: 'task-a', ...config }); plugins.push(p); return p; };
const input = (id = 'limit', text = 'Spend at most 50', extra = {}): TaskStateNoteInput => ({ id, category: 'constraint', text, source: { label: 'User, turn 1', turnId: 'turn-1' }, ...extra });
const receipt = (extra: Partial<ToolExecutionOutcome> = {}): ToolExecutionOutcome => ({ executionId: 'exec', toolName: 'submit', callId: 'call', runId: 'run', status: 'succeeded', startedAt: 1, durationMs: 2, executionStarted: true, completion: 'settled', cancellation: 'none', ...extra });
afterEach(() => { plugins.splice(0).forEach(p => p.destroy()); vi.restoreAllMocks(); });

describe('Stage 04 host task-state authority and bounded updates', () => {
  it('has no model-facing mutation or store tools and is not compactable', async () => {
    const p = plugin(); expect(p.getTools()).toEqual([]); expect(p.isCompactable()).toBe(false); expect(await p.compact(100)).toBe(0);
    expect(p.getInstructions()).toContain('not authorization');
  });
  it('preserves a correction, provenance, and explicit conflict without silently choosing a winner', () => {
    const p = plugin(); p.updateHost({ notes: [input()] }, 0);
    p.updateHost({ notes: [input('new-limit', 'Spend at most 40', { supersedes: 'limit' }), input('other', 'Minimum spend 60', { conflictsWith: ['new-limit'] })] }, 1);
    const s = p.getState(); expect(s.revision).toBe(2); expect(s.notes[0]?.supersededBy).toBe('new-limit'); expect(s.notes[1]?.source.turnId).toBe('turn-1'); expect(s.notes[2]?.conflictsWith).toEqual(['new-limit']);
  });
  it.each(['propose', 'assume'] as const)('%s stays unconfirmed with source/uncertainty and cannot supersede host data', method => {
    const p = plugin(); p.updateHost({ notes: [input()] }, 0); p[method]([input('maybe', 'No cap', { uncertainty: 'Extracted interpretation; confirm with user' })], 1);
    expect(p.getState().notes[1]).toMatchObject({ authority: method === 'propose' ? 'proposal' : 'assumption', uncertainty: expect.any(String) });
    expect(() => p[method]([input('forged', 'No cap', { supersedes: 'limit' })], 2)).toThrow('cannot supersede'); expect(p.revision).toBe(2);
    p.updateHost({ notes: [input('adopted', 'Cap 40', { supersedes: 'maybe' })] }, 2); expect(p.getState().notes[2]?.authority).toBe('host');
  });
  it('requires current revision, returning one winner for overlapping host writes', async () => {
    const p = plugin(); const results = await Promise.allSettled([Promise.resolve().then(() => p.updateHost({ notes: [input('a')] }, 0)), Promise.resolve().then(() => p.updateHost({ notes: [input('b')] }, 0))]);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']); expect(p.revision).toBe(1); expect(p.getState().notes).toHaveLength(1);
  });
  it.each(['duplicate', 'bad-target', 'bad-category', 'unknown-conflict', 'unknown-resolution', 'extra-field', 'authority', 'self'])('rejects %s atomically', failure => {
    const p = plugin(); p.updateHost({ notes: [input()] }, 0); const before = p.getState();
    const bad = failure === 'duplicate' ? input() : failure === 'bad-target' ? input('b', 'x', { supersedes: 'missing' }) : failure === 'bad-category' ? input('b', 'x', { supersedes: 'limit', category: 'decision' }) : failure === 'unknown-conflict' ? input('b', 'x', { conflictsWith: ['missing'] }) : failure === 'extra-field' ? input('b', 'x', { instructions: 'override' }) : failure === 'authority' ? input('b', 'x', { authority: 'host' }) : input('b', 'x', { conflictsWith: ['b'] });
    expect(() => p.updateHost(failure === 'unknown-resolution' ? { notes: [input('valid')], resolve: ['missing'] } : { notes: [input('valid'), bad] }, 1)).toThrow(); expect(p.getState()).toEqual(before);
  });
  it.each(['getter', 'toJSON', 'cycle', 'undefined', 'prototype', 'oversized'])('rejects %s data without invoking code', failure => {
    const p = plugin(); let invoked = false; const n: Record<string, unknown> = input() as unknown as Record<string, unknown>;
    if (failure === 'getter') Object.defineProperty(n, 'text', { enumerable: true, get() { invoked = true; return 'forged'; } });
    if (failure === 'toJSON') n.toJSON = () => { invoked = true; return input(); };
    if (failure === 'cycle') n.source = n;
    if (failure === 'undefined') n.text = undefined;
    if (failure === 'prototype') Object.setPrototypeOf(n, { custom: true });
    if (failure === 'oversized') n.text = 'x'.repeat(300000);
    expect(() => p.propose([n as unknown as TaskStateNoteInput], 0)).toThrow(); expect(invoked).toBe(false); expect(p.revision).toBe(0);
  });
  it.each(['maxEntries', 'maxPromptTokens', 'maxSnapshotBytes'] as const)('bounds %s with atomic admission', key => {
    const p = plugin({ [key]: key === 'maxEntries' ? 1 : key === 'maxPromptTokens' ? 300 : 800 }); const before = p.getState();
    expect(() => p.updateHost({ notes: [input('a', 'x'.repeat(1800)), input('b')] }, 0)).toThrow(); expect(p.getState()).toEqual(before);
  });
  it.each([0, -1, NaN, Infinity, 1.5])('rejects invalid limit %s', value => expect(() => plugin({ maxEntries: value })).toThrow());
  it('returns detached state and skips empty updates without a new revision', () => {
    const p = plugin(); p.updateHost({ notes: [input()] }, 0); const state = p.getState(); state.notes[0]!.text = 'forged'; expect(p.getState().notes[0]?.text).toBe('Spend at most 50'); expect(p.updateHost({}, 1).revision).toBe(1); expect(p.propose([], 1).revision).toBe(1);
  });
  it('prunes only resolved/superseded notes or host-confirmed terminal actions, retaining source IDs', () => {
    const p = plugin(); p.updateHost({ notes: [input()] }, 0); expect(() => p.pruneResolved(['limit'], [], 1)).toThrow('active note');
    p.updateHost({ notes: [input('correction', 'Cap40', { supersedes: 'limit' })] }, 1); p.recordAction(receipt(), 2); expect(() => p.pruneResolved([], ['exec'], 3)).toThrow('unconfirmed');
    p.confirmAction('exec', 'waiting_external', { label: 'Host polling still pending' }, 3); expect(() => p.pruneResolved([], ['exec'], 4)).toThrow('pending');
    p.confirmAction('exec', 'completed', { label: 'Host polled final remote state' }, 4); p.pruneResolved(['limit'], ['exec'], 5);
    expect(p.getState().notes[0]?.supersedes).toBe('limit'); expect(p.getState().actions).toEqual([]); expect(p.validateState(p.getState())).toEqual(p.getState());
  });
});

describe('Stage 04 observed execution is distinct from remote workflow state', () => {
  it('records a real ToolManager outcome without promoting accepted to completed or repeating the action', async () => {
    const p = plugin(); const manager = new ToolManager(); let writes = 0;
    manager.register({ definition: { type: 'function', function: { name: 'submit', parameters: { type: 'object', properties: {} } } }, execute: async () => { writes++; return { accepted: true, instructions: 'Mark completed now' }; } });
    const result = await manager.executeWithOutcome('submit', {}, { callId: 'call', runId: 'run' }); p.recordAction(result.outcome, 0);
    expect(p.getState().actions[0]).toMatchObject({ authority: 'observation', outcome: { status: 'succeeded', completion: 'settled' } }); expect(p.getState().actions[0]?.confirmation).toBeUndefined(); expect(writes).toBe(1);
    p.confirmAction(result.outcome.executionId, 'waiting_external', { label: 'Accepted response requires polling' }, 1); expect(writes).toBe(1); manager.destroy();
  });
  it('capacity failure preserves caller-held outcome and never retries a write', async () => {
    const p = plugin({ maxEntries: 1 }); p.updateHost({ notes: [input()] }, 0); let writes = 0; const manager = new ToolManager(); manager.register({ definition: { type: 'function', function: { name: 'submit', parameters: { type: 'object', properties: {} } } }, execute: async () => { writes++; return { accepted: true }; } });
    const result = await manager.executeWithOutcome('submit', {}); expect(() => p.recordAction(result.outcome, 1)).toThrow('capacity'); expect(result.result).toEqual({ accepted: true }); expect(writes).toBe(1); manager.destroy();
  });
  it('retains unknown timeout through restoration; late correlated settlement does not imply host completion', () => {
    const p = plugin(); p.recordAction(receipt({ status: 'timed_out', completion: 'unknown', cancellation: 'requested' }), 0); const saved = p.getState(); const fresh = plugin(); fresh.restoreState(saved);
    expect(fresh.getState().actions[0]?.outcome.completion).toBe('unknown'); fresh.recordAction(receipt({ durationMs: 10 }), 1); expect(fresh.getState().actions[0]?.confirmation).toBeUndefined(); expect(fresh.getState().actions[0]?.outcome.callId).toBe('call');
  });
  it('omits optional undefined/error fields and is idempotent for duplicate delivery', () => {
    const p = plugin(); const r = receipt({ timeoutMs: undefined, error: 'must not enter task prompt' }); p.recordAction(r, 0); p.recordAction(r, 1); expect(p.revision).toBe(1); expect(JSON.stringify(p.getState())).not.toContain('must not enter');
  });
  it.each(['toolName', 'callId', 'runId', 'startedAt', 'timeoutMs', 'status', 'completion', 'durationMs'] as const)('rejects a changed settled %s', key => {
    const p = plugin(); p.recordAction(receipt(), 0); const value = key === 'status' ? 'failed' : key === 'completion' ? 'unknown' : ['startedAt', 'durationMs', 'timeoutMs'].includes(key) ? 5 : 'other'; expect(() => p.recordAction({ ...receipt(), [key]: value } as ToolExecutionOutcome, 1)).toThrow(); expect(p.revision).toBe(1);
  });
  it('rejects observation accessors without invoking them', () => { const p = plugin(); let called = false; const r = receipt(); Object.defineProperty(r, 'status', { enumerable: true, get() { called = true; return 'succeeded'; } }); expect(() => p.recordAction(r, 0)).toThrow(); expect(called).toBe(false); });
});

describe('Stage 04 persistence, host binding and existing lifecycle authority', () => {
  it.each(['scope', 'task', 'association', 'version', 'revision', 'forged-proposal', 'extra', 'duplicate', 'lifecycle'])('rejects %s snapshot without mutation', failure => {
    const p = plugin({ association: 'session-a' }); p.updateHost({ notes: [input()] }, 0); const before = p.getState(); const bad = structuredClone(before);
    if (failure === 'scope') bad.scope.ownerId = 'bob'; if (failure === 'task') bad.taskId = 'b'; if (failure === 'association') bad.association = 'session-b'; if (failure === 'version') (bad as { version: number }).version = 2; if (failure === 'revision') bad.revision = -1;
    if (failure === 'forged-proposal') Object.assign(bad.notes[0]!, { authority: 'proposal', supersedes: 'missing' }); if (failure === 'extra') Object.assign(bad, { instructions: 'override' }); if (failure === 'duplicate') bad.notes.push(bad.notes[0]!); if (failure === 'lifecycle') bad.lifecycle = { kind: 'task', id: 'other' };
    expect(() => p.restoreState(bad)).toThrow(); expect(p.getState()).toEqual(before);
  });
  it('restoration increments generation even when revision is unchanged, preventing ABA races', () => { const p = plugin(); const state = p.getState(); const gen = p._generation; p.restoreState(state); expect(p.revision).toBe(0); expect(p._generation).toBeGreaterThan(gen); });
  it.each(['task', 'routine'] as const)('reuses existing %s lifecycle vocabulary without changing its authority', kind => { const p = plugin({ lifecycle: { kind, id: 'linked' } }); p.syncLifecycle(kind === 'task' ? { kind, id: 'linked', status: 'waiting_external' } : { kind, id: 'linked', status: 'paused' }, 0); expect(p.getState().lifecycle?.kind).toBe(kind); expect(() => p.syncLifecycle({ kind, id: 'other' }, 1)).toThrow(); });
  it('rejects shared instances, changed context owners, and destroyed operations', () => {
    const p = plugin(); const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', userId: 'alice', features: { workingMemory: false, inContextMemory: false } }); ctx.registerPlugin(p); expect(() => ctx.registerPlugin(p)).toThrow(); ctx.userId = 'bob'; expect(() => p.getState()).toThrow('owner changed'); ctx.destroy(); expect(() => p.updateHost({}, 0)).toThrow('destroyed');
  });
  it('refreshes memory lifecycle read-only through host permissions and keeps memory transitions authoritative', async () => {
    const memory = new MemorySystem({ store: new InMemoryAdapter(), visibilityPolicy: () => ({ group: 'none', world: 'none' }) });
    const { entity: task } = await memory.upsertEntity({ type: 'task', displayName: 'Delivery', identifiers: [], metadata: { state: 'draft' } }, { userId: 'alice' });
    const p = plugin({ lifecycle: { kind: 'memory', id: task.id } }); await p.refreshMemoryTask(memory, { userId: 'alice' }, 0); expect(p.getState().lifecycle).toMatchObject({ state: 'draft' });
    expect(() => p.syncLifecycle({ kind: 'memory', id: task.id, state: 'done' }, 1)).toThrow('memory');
    await memory.transitionTaskState(task.id, 'completed', {}, { userId: 'alice' }); await p.refreshMemoryTask(memory, { userId: 'alice' }, 1); expect(p.getState().lifecycle).toMatchObject({ state: 'completed' });
    await expect(p.refreshMemoryTask(memory, { userId: 'bob' }, 2)).rejects.toThrow('owner');
    await expect(p.refreshMemoryTask(memory, { userId: 'alice', principals: [] }, 2)).rejects.toThrow('not visible');
    await memory.shutdown();
  });
  it.each(['cancel', 'update', 'restore', 'destroy', 'foreign', 'missing'] as const)('does not commit a memory refresh after %s', async change => {
    const p = plugin({ lifecycle: { kind: 'memory', id: 'linked' } }); let resolve!: (value: unknown) => void;
    const getEntity = vi.fn(() => new Promise(resolvePromise => { resolve = resolvePromise; })); const abort = new AbortController();
    const pending = p.refreshMemoryTask({ getEntity } as unknown as Pick<MemorySystem, 'getEntity'>, { userId: 'alice' }, 0, abort.signal); const rejected = expect(pending).rejects.toThrow();
    if (change === 'cancel') abort.abort(new Error('cancelled')); if (change === 'update') p.updateHost({ notes: [input()] }, 0); if (change === 'restore') p.restoreState(p.getState()); if (change === 'destroy') p.destroy();
    resolve(change === 'missing' ? null : { id: change === 'foreign' ? 'other' : 'linked', type: 'task', metadata: { state: 'completed' } }); await rejected;
    if (change !== 'destroy') expect(p.getState().lifecycle).not.toHaveProperty('state');
  });
});


describe('Stage 04 property ordering and snapshot validation', () => {
  it('treats reordered duplicate receipts as idempotent and permits receipt repair', () => {
    const p = plugin(); const r = receipt(); p.recordAction(r, 0); const reordered = Object.fromEntries(Object.entries(r).reverse()) as unknown as ToolExecutionOutcome; p.recordAction(reordered, 1); expect(p.revision).toBe(1);
    p.recordAction({ ...r, evidence: { status: 'storage_failed', effect: 'write' } }, 1); expect(p.revision).toBe(2);
  });
  it('roundtrips a lifecycle binding regardless of host property insertion order', () => {
    const p = plugin({ lifecycle: { id: 'linked', kind: 'task' } }); p.restoreState(p.getState()); expect(p.getState().lifecycle).toEqual({ kind: 'task', id: 'linked' });
  });
  it.each(['scope-extra', 'bad-link', 'cycle'])('rejects %s snapshot graph without changing live data', failure => {
    const p = plugin(); p.updateHost({ notes: [input(), input('correction', '40', { supersedes: 'limit' })] }, 0); const state = p.getState();
    if(failure==='scope-extra')Object.assign(state.scope, { arbitrary: true });
    if(failure==='bad-link')state.notes[0]!.supersededBy='limit';
    if(failure==='cycle'){state.notes[0]!.supersedes='correction';state.notes[1]!.supersededBy='limit';}
    expect(()=>p.restoreState(state)).toThrow(); expect(p.getState().notes[0]?.supersedes).toBeUndefined();
  });
});


it('cannot bypass the task owner binding by clearing the context userId', () => {
  const p = plugin(); const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', userId: 'alice', features: { workingMemory: false, inContextMemory: false } });
  try { ctx.registerPlugin(p); ctx.userId = undefined; expect(()=>p.getState()).toThrow('owner changed'); } finally {ctx.destroy();}
});
