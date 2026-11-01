import { describe, expect, it, vi } from 'vitest';
import { AgentEventHistoryExpiredError, AgentSessionRecoveryError } from 'oneringai/agent-runtime';
import type { AgentRun, AgentRunResult, RuntimeSessionReference } from 'oneringai/agent-runtime';
import { AmosRuntimeController, type AmosRuntimeHost, type AmosRuntimeView } from '../../../../apps/amos/src/runtime/AmosRuntimeController.js';
import { runtimeReference, runtimeRun } from '../../../../apps/amos/src/runtime/commands.js';

const reference: RuntimeSessionReference = { version: 1, id: 'session_commands' };
const result: AgentRunResult = { runId: 'run_original', sessionId: reference.id, status: 'completed', outputText: 'ACK', artifacts: [] };
function run(value = Promise.resolve(result)): AgentRun {
  return { id: result.runId, sessionId: reference.id, result: value, events: vi.fn(() => (async function* () {})()), cancel: vi.fn(), steer: vi.fn(), respondToInteraction: vi.fn() };
}
function fixture() {
  const current = run();
  const session = {
    id: reference.id, agentId: 'logical', state: 'ready', isDestroyed: false, capabilities: { driverId: 'future-driver', capabilities: {} },
    reference: () => reference, inspectState: vi.fn(async () => ({ connection: 'attached', activity: 'ready', unresolvedEffects: false })),
    run: vi.fn(async () => current), getRun: vi.fn(async () => current), cancelActiveRun: vi.fn(async () => {}),
    detach: vi.fn(async () => {}), destroy: vi.fn(async () => {}),
    uploadFile: vi.fn(async () => ({ type: 'reference', reference: 'scoped-upload', name: 'input.txt' })),
    downloadArtifact: vi.fn(async () => ({ path: '/host/transfers/result.txt', bytes: 3, mediaType: 'text/plain' })),
  };
  const handle = { inspect: vi.fn(async () => session.capabilities), openSession: vi.fn(async () => session) };
  const runtime = { createAgent: vi.fn(() => handle), resumeSession: vi.fn(async () => session), deleteSession: vi.fn(async () => {}), destroy: vi.fn(async () => {}) };
  const saveReference = vi.fn(async (_reference: RuntimeSessionReference | undefined) => {});
  const host = { runtime, definition: { id: 'logical', instructions: '' }, options: { context: { tenantId: 'trusted-tenant', userId: 'trusted-owner' }, execution: { driver: 'future-driver', connector: 'host-account', model: 'host-model' } }, saveReference } as unknown as AmosRuntimeHost;
  const views: AmosRuntimeView[] = []; const controller = new AmosRuntimeController(host, view => views.push(view));
  return { controller, host, session, runtime, handle, current, saveReference, views };
}

describe('complete AMOS runtime command surface', () => {
  it('forwards explicit run options and exposes run IDs and saved terminal results', async () => {
    const f = fixture();
    try {
      await f.controller.open();
      const options = { requestId: 'stable', model: 'other-model', reasoning: { effort: 'low' }, responseFormat: { type: 'json_schema', schema: { type: 'object' } }, metadata: { label: 'example' } };
      await f.controller.input(`/run ${JSON.stringify({ input: { parts: [{ type: 'text', text: 'task' }] }, options })}`); await f.controller.wait();
      expect(f.session.run).toHaveBeenCalledWith({ parts: [{ type: 'text', text: 'task' }] }, options);
      expect(f.views.find(view => view.type === 'run')?.data).toMatchObject({ runId: result.runId, requestId: 'stable' });
      await f.controller.input(`/result ${result.runId}`); expect(f.session.getRun).toHaveBeenCalledWith(result.runId);
      expect(f.views.filter(view => view.type === 'result')).toHaveLength(2); expect(f.saveReference).toHaveBeenCalledWith(reference);
    } finally { await f.controller.close(); }
  });
  it('supports explicit bounded file commands without altering trusted scope', async () => {
    const f = fixture();
    try {
      await f.controller.open();
      await f.controller.input('/upload {"path":"notes/input.txt","name":"renamed.txt","mediaType":"text/plain"}');
      await f.controller.input('/download {"reference":"scoped-artifact","path":"notes/result.txt"}');
      expect(f.session.uploadFile).toHaveBeenCalledWith({ path: 'notes/input.txt', name: 'renamed.txt', mediaType: 'text/plain' });
      expect(f.session.downloadArtifact).toHaveBeenCalledWith({ reference: 'scoped-artifact', path: 'notes/result.txt' });
      expect(f.views.some(view => view.type === 'upload')).toBe(true); expect(f.views.find(view => view.type === 'download')?.data).toMatchObject({ bytes: 3 });
      expect(f.host.options.context).toEqual({ tenantId: 'trusted-tenant', userId: 'trusted-owner' });
    } finally { await f.controller.close(); }
  });
  it('reports a file failure once and permits host repair without starting a model turn', async () => {
    const f = fixture();
    try {
      await f.controller.open(); f.session.uploadFile.mockRejectedValueOnce(new Error('Uncertain upload; reconcile original intent'));
      await expect(f.controller.input('/upload {"path":"a.txt","mediaType":"text/plain"}')).rejects.toThrow('reconcile');
      expect(f.session.uploadFile).toHaveBeenCalledOnce(); expect(f.session.run).not.toHaveBeenCalled();
      await f.controller.input('/status'); expect(f.views.at(-1)?.type).toBe('state');
    } finally { await f.controller.close(); }
  });
  it('exposes scoped reference resume across controllers and new sessions separately', async () => {
    const f = fixture();
    try {
      await f.controller.input(`/resume ${JSON.stringify(reference)}`);
      expect(f.runtime.resumeSession).toHaveBeenCalledWith(reference, { context: f.host.options.context, observation: undefined });
      await f.controller.input('/detach'); await f.controller.input('/reference'); expect(f.views.at(-1)).toEqual({ type: 'reference', data: reference });
      await f.controller.input('/new'); expect(f.handle.openSession).toHaveBeenCalledOnce(); expect(f.runtime.deleteSession).not.toHaveBeenCalled();
    } finally { await f.controller.close(); }
  });
  it('deletes only the explicitly selected reference and clears persistence after success', async () => {
    const f = fixture();
    try {
      await f.controller.open(); await expect(f.controller.input('/delete {"version":1,"id":"session_other"}')).rejects.toThrow('Detach');
      await f.controller.input('/delete');
      expect(f.runtime.deleteSession).toHaveBeenCalledExactlyOnceWith(reference, { context: f.host.options.context });
      expect(f.saveReference).toHaveBeenLastCalledWith(undefined); expect(f.controller.snapshot()).toMatchObject({ reference: null, attached: false });
      await f.controller.input('/new'); expect(f.handle.openSession).toHaveBeenCalledTimes(2);
    } finally { await f.controller.close(); }
  });
  it('retains a failed deletion reference for retry instead of clearing host persistence', async () => {
    const f = fixture();
    try {
      await f.controller.open(); f.runtime.deleteSession.mockRejectedValueOnce(new Error('Unresolved effect')); f.session.isDestroyed = true;
      await expect(f.controller.input('/delete')).rejects.toThrow('Unresolved');
      expect(f.controller.snapshot()).toMatchObject({ reference, attached: false }); expect(f.saveReference).not.toHaveBeenCalledWith(undefined);
      await f.controller.input('/delete'); expect(f.runtime.deleteSession).toHaveBeenCalledTimes(2); expect(f.saveReference).toHaveBeenLastCalledWith(undefined);
    } finally { await f.controller.close(); }
  });
  it('repairs locator clearing after successful deletion without repeating native cleanup', async () => {
    const f = fixture();
    try {
      await f.controller.open(); f.saveReference.mockRejectedValueOnce(new Error('Locator clear failed'));
      await expect(f.controller.input('/delete')).rejects.toThrow('Locator clear failed');
      expect(f.views.some(view => view.type === 'deleted')).toBe(true); expect(f.controller.snapshot().reference).toBeNull();
      await f.controller.input('/save'); expect(f.saveReference).toHaveBeenLastCalledWith(undefined); expect(f.runtime.deleteSession).toHaveBeenCalledOnce();
    } finally { await f.controller.close(); }
  });
  it('retains and persists a recoverable native open failure', async () => {
    const f = fixture();
    try {
      f.handle.openSession.mockRejectedValueOnce(new AgentSessionRecoveryError('Native setup acknowledgement lost', reference));
      await expect(f.controller.open()).rejects.toThrow('acknowledgement');
      expect(f.controller.snapshot()).toMatchObject({ reference, attached: false }); expect(f.saveReference).toHaveBeenCalledWith(reference);
      await f.controller.input('/resume'); expect(f.runtime.resumeSession).toHaveBeenCalledOnce(); expect(f.session.run).not.toHaveBeenCalled();
    } finally { await f.controller.close(); }
  });
  it('keeps a usable reference and handle when reference persistence fails', async () => {
    const f = fixture();
    try {
      f.saveReference.mockRejectedValueOnce(new Error('Host reference storage full'));
      await expect(f.controller.open()).rejects.toThrow('storage full'); expect(f.controller.snapshot()).toMatchObject({ reference, attached: true });
      expect(f.views.find(view => view.type === 'reference-save-error')?.data).toMatchObject({ reference });
      await f.controller.input('/save'); expect(f.saveReference).toHaveBeenCalledTimes(2); expect(f.views.at(-1)?.type).toBe('reference-saved');
      await f.controller.input('/status'); expect(f.session.run).not.toHaveBeenCalled();
    } finally { await f.controller.close(); }
  });
  it('reobserves an attached failed session without sending its original prompt again', async () => {
    const f = fixture();
    try {
      await f.controller.open(); f.session.state = 'failed'; await f.controller.input('/resume');
      expect(f.session.detach).toHaveBeenCalledOnce(); expect(f.runtime.resumeSession).toHaveBeenCalledOnce(); expect(f.session.run).not.toHaveBeenCalled();
    } finally { await f.controller.close(); }
  });
  it('passes an activity cursor and reports expired activity without losing the saved result', async () => {
    const f = fixture();
    try {
      await f.controller.open(); vi.mocked(f.current.events).mockImplementation(() => { throw new AgentEventHistoryExpiredError(result.runId); });
      await f.controller.input(`/observe {"runId":"${result.runId}","afterSequence":5}`); await f.controller.wait();
      expect(f.current.events).toHaveBeenCalledWith({ afterSequence: 5 }); expect(f.views.some(view => view.type === 'activity-gap')).toBe(true); expect(f.views.find(view => view.type === 'result')?.data).toEqual(result);
    } finally { await f.controller.close(); }
  });
  it('preserves the existing string observation-error frame and independent terminal result', async () => {
    const f = fixture();
    try {
      await f.controller.open(); vi.mocked(f.current.events).mockImplementation(() => { throw new Error('Observation failed'); });
      await f.controller.input('task'); await f.controller.wait();
      expect(f.views.find(view => view.type === 'observation-error')?.data).toBe('Error: Observation failed');
      expect(f.views.find(view => view.type === 'result')?.data).toEqual(result);
    } finally { await f.controller.close(); }
  });
  it('does not attach duplicate observers for a repeated active request ID', async () => {
    const f = fixture(); let finish!: (value: AgentRunResult) => void; const active = run(new Promise(resolve => { finish = resolve; })); f.session.run.mockResolvedValue(active);
    try {
      await f.controller.open(); await f.controller.input('/run {"input":"task","options":{"requestId":"stable"}}');
      await f.controller.input('/run {"input":"task","options":{"requestId":"stable"}}'); expect(active.events).toHaveBeenCalledOnce();
      expect(f.views.filter(view => view.type === 'run').at(-1)?.data).toMatchObject({ alreadyObserved: true });
      finish(result); await f.controller.wait();
    } finally { finish(result); await f.controller.close(); }
  });
  it('reads an older request replay while preserving the current active observer', async () => {
    const f = fixture(); let finish!: (value: AgentRunResult) => void;
    const active = { ...run(new Promise(resolve => { finish = resolve; })), id: 'run_current' };
    f.session.run.mockResolvedValueOnce(active).mockResolvedValueOnce(f.current);
    try {
      await f.controller.open(); await f.controller.input('/run {"input":"current","options":{"requestId":"current"}}');
      await f.controller.input('/run {"input":"old","options":{"requestId":"old"}}');
      expect(f.controller.snapshot().activeRunId).toBe('run_current'); expect(active.events).toHaveBeenCalledOnce(); expect(f.current.events).not.toHaveBeenCalled();
      finish({ ...result, runId: active.id }); await f.controller.wait();
    } finally { finish(result); await f.controller.close(); }
  });
  it.each([
    '/run {"input":"task","options":{"context":{"userId":"foreign"}}}', '/run {"input":"task","options":{"signal":{}}}',
    '/run {"input":{}}', '/run {"input":{"parts":[{"type":"text","text":7}]}}',
    '/upload {"path":"x","mediaType":"text/plain","root":"/private"}', '/upload {"path":7,"mediaType":"text/plain"}',
    '/download {"reference":"x","path":"a","connector":"foreign"}', '/download []',
    '/resume {"version":1,"id":"session_other","context":{}}', '/observe {"runId":"r","afterSequence":-1}',
    '/inspect unexpected', '/model other',
  ])('rejects malformed or host-owned command data before execution: %s', async line => {
    const f = fixture(); try { await f.controller.open(); await expect(f.controller.input(line)).rejects.toThrow(); expect(f.session.run).not.toHaveBeenCalled(); expect(f.session.uploadFile).not.toHaveBeenCalled(); expect(f.session.downloadArtifact).not.toHaveBeenCalled(); expect(f.runtime.deleteSession).not.toHaveBeenCalled(); } finally { await f.controller.close(); }
  });
  it('validates reference/input syntax without interpreting text as executable code', () => {
    expect(() => runtimeReference('{"version":2,"id":"session_x"}')).toThrow('version 1');
    expect(() => runtimeRun('console.log("x")')).toThrow('Expected JSON');
    expect(runtimeRun('{"input":"/delete"}').input).toBe('/delete');
  });
});
