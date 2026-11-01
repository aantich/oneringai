/** Offline: denied host tools and retained-result repair after a lost storage acknowledgement. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Connector, PermissionPolicyManager } from 'oneringai';
import { AgentRuntime, LocalExecutionBackend, FileRuntimeSessionStorage } from 'oneringai/agent-runtime';
import type { IRuntimeSessionStorage, JsonObject } from 'oneringai/agent-runtime';
import { offlineHarness } from './agent-runtime/harness-fixtures.js';

const root = await mkdtemp(path.join(tmpdir(), 'runtime-safety-'));
const fixture = offlineHarness('oneringai.agent', root);
const permissions = PermissionPolicyManager.fromConfig({ blocklist: ['probe'] });
const storage = new FileRuntimeSessionStorage(path.join(root, 'safety-control'));
let loseAcknowledgement = false;
let authorizationRevision = 'denied-v1';
const injectedStorage: IRuntimeSessionStorage = {
  durability: storage.durability,
  acquire: async (id, scope) => {
    const lease = await storage.acquire(id, scope);
    return { ...lease, write: async (data, revision) => {
      const saved = await lease.write(data, revision);
      if (loseAcknowledgement && !data.activeRunId && Object.values((data.runs ?? {}) as JsonObject).some(run => (run as JsonObject).state === 'terminal')) {
        loseAcknowledgement = false;
        throw new Error('Offline simulation: acknowledgement lost after commit');
      }
      return saved;
    } };
  },
};
const runtime = new AgentRuntime({ backend: new LocalExecutionBackend({ drivers: [fixture.implementation], sessionStorage: injectedStorage,
  resolveTools: () => ({ ...fixture.toolResolution, fingerprint: authorizationRevision, permissionManager: permissions }),
}) });
try {
  const assistant = runtime.createAgent(fixture.definition);
  const denied = await assistant.openSession(fixture.options);
  await (await denied.run('Use probe.')).result;
  assert.equal(fixture.calls(), 0, 'A denied host tool must not execute');
  await denied.destroy();

  // A host authorization change opens a fresh session with a new fingerprint.
  permissions.blocklistRemove('probe'); authorizationRevision = 'allowed-v2';
  const allowed = await assistant.openSession(fixture.options);
  loseAcknowledgement = true;
  const run = await allowed.run('Use probe once.', { requestId: 'original-input' });
  await assert.rejects(run.result, /Retry getRun/);
  assert.equal(fixture.calls(), 1);
  // Repair bookkeeping by reading the retained result. Never resubmit the task.
  const repaired = await (await allowed.getRun(run.id)).result;
  assert.equal(repaired.runId, run.id); assert.equal(repaired.status, 'completed');
  assert.equal(fixture.calls(), 1);
  const reference = allowed.reference(); await allowed.detach();
  const restored = await runtime.resumeSession(reference, { context: fixture.options.context });
  assert.equal((await (await restored.getRun(run.id)).result).runId, run.id);
  assert.equal(fixture.calls(), 1);
  console.log({ mocked: true, blockedToolExecutions: 0, authorizedToolExecutions: fixture.calls(), repairedWithoutReplay: true });
} finally {
  await runtime.destroy(); await fixture.runtime.destroy(); permissions.destroy(); Connector.clear();
  await rm(root, { recursive: true, force: true });
}
