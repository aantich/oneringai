import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createRoutineDefinition, createRoutineExecutionRecord } from 'oneringai';
import { createHoseaStorage } from '../src/main/storage.js';

test('preview persistence cannot read or overwrite a normal workspace with matching IDs', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'hosea-storage-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const normalRoot = join(temporary, 'normal');
  const previewRoot = join(temporary, 'preview');
  const normal = createHoseaStorage(normalRoot);
  const preview = createHoseaStorage(previewRoot);
  const id = 'same-agent';
  const instruction = { id: 'style', content: 'normal workspace', createdAt: 1, updatedAt: 1 };
  await normal.persistentInstructions(id).save([instruction]);
  assert.equal(await preview.persistentInstructions(id).load(), null);
  await preview.persistentInstructions(id).save([{ ...instruction, content: 'preview workspace' }]);
  assert.equal((await normal.persistentInstructions(id).load())?.[0]?.content, 'normal workspace');

  await normal.sessions(id).save('same-session', { conversation: [], pluginStates: {}, metadata: { model: 'offline', savedAt: 1 } });
  assert.deepEqual(await preview.sessions(id).list(), []);
  await preview.sessions(id).save('same-session', { conversation: [], pluginStates: {}, metadata: { model: 'preview', savedAt: 2 } });
  assert.equal((await normal.sessions(id).load('same-session'))?.state.metadata.model, 'offline');

  const routine = createRoutineDefinition({ id: 'same-routine', name: 'Normal routine', description: '', tasks: [] });
  await normal.routineDefinitions().save(undefined, routine);
  assert.deepEqual(await preview.routineDefinitions().list(undefined), []);
  await preview.routineDefinitions().save(undefined, { ...routine, name: 'Preview routine' });
  assert.equal((await normal.routineDefinitions().load(undefined, routine.id))?.name, 'Normal routine');

  const record = createRoutineExecutionRecord(routine, 'offline', 'offline');
  await preview.routineExecutions().insert(undefined, record);
  assert.deepEqual(await normal.routineExecutions().list(undefined), []);

  const rule = { id: 'same-rule', toolName: '*', action: 'deny' as const, unconditional: true,
    enabled: true, createdBy: 'user' as const, createdAt: '2026-11-01', updatedAt: '2026-11-01' };
  await preview.permissionRules.save(undefined, [rule]);
  assert.equal(await normal.permissionRules.load(undefined), null);
  assert.equal((await preview.permissionRules.load(undefined))?.[0]?.action, 'deny');

  const media = await preview.media.save(Buffer.from('preview'), { type: 'image', format: 'png', model: 'offline', vendor: 'offline' });
  assert.ok(!relative(previewRoot, media.location).startsWith('..'));
  assert.equal((await readdir(normalRoot)).includes('media'), false);
  assert.ok(preview.agentDefinitions.getPath().startsWith(previewRoot));
});
