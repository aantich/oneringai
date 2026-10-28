import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireComposition } from '@/core/execution/composition.js';
import { RoutineObservations } from '@/core/routines/observations.js';
import { preflightRoutine } from '@/core/routines/preflight.js';
import { createRoutineDefinition } from '@/domain/entities/Routine.js';
import { Connector } from '@/core/Connector.js';
import { fixture } from './routing/fixture.js';
import type { Agent } from '@/core/Agent.js';
import type { RoutineObservation } from '@/core/routines/types.js';
import type { EvidenceReference } from '@/domain/interfaces/IEvidenceStorage.js';

const agents: Agent[] = [];
const make = () => { const f = fixture(); agents.push(f.agent); return f; };
afterEach(() => { agents.splice(0).forEach(agent => agent.destroy()); Connector.clear(); });
const reference = (id: string): EvidenceReference => ({ version: 1, id, sha256: 'a'.repeat(64), bytes: 1, durability: 'process' });

describe('verified routine foundation', () => {
  it('denies an excluded tool even if a loader re-enables it, through the existing outcome path', async () => {
    const { agent } = make(); const execute = vi.fn(async () => ({ id: 'never' }));
    agent.tools.register({ definition: { type: 'function', function: { name: 'excluded', parameters: { type: 'object', properties: {} } } }, execute });
    const owner = acquireComposition(agent); const restore = owner.enterScope(new Set());
    agent.tools.disable('excluded'); agent.tools.enable('excluded');
    const report = await agent.tools.executeWithOutcome('excluded', {});
    expect(report.outcome).toMatchObject({ status: 'denied', executionStarted: false, completion: 'not_started' });
    expect(execute).not.toHaveBeenCalled(); expect(report.result).toMatchObject({ success: false }); restore(); owner.release();
  });

  it('captures scope/effect at admission and prevents out-of-order scope widening', async () => {
    const { agent } = make(); let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    const execute = vi.fn(async () => 'read'); const tool = { definition: { type: 'function' as const, function: { name: 'read', parameters: { type: 'object', properties: {} } } }, output: { effect: 'read' as 'read' | 'write' }, execute };
    agent.tools.register(tool); agent.tools.executionPipeline.use({ name: 'gate', beforeExecute: async () => gate });
    const owner = acquireComposition(agent); const restore = owner.enterScope(new Set(['read'])); const effects: string[] = [];
    owner.onToolObservation(observation => effects.push(observation.effect));
    const running = agent.tools.execute('read', {}); const inner = owner.enterScope(new Set()); tool.output.effect = 'write';
    expect(restore).toThrow(/stack order/); release(); expect(await running).toBe('read');
    expect((await agent.tools.executeWithOutcome('read', {})).outcome.status).toBe('denied');
    expect(execute).toHaveBeenCalledTimes(1); expect(effects).toEqual(['read', 'write']); inner(); restore(); owner.release();
  });

  it('captures actual raw observations before a throwing public listener can lose them', async () => {
    const { agent } = make(); const raw = Object.freeze({ id: 'actual' });
    agent.tools.register({ definition: { type: 'function', function: { name: 'actual', parameters: { type: 'object', properties: {} } } }, execute: async () => raw });
    agent.tools.on('tool:outcome', () => { throw new Error('UI failed'); });
    const owner = acquireComposition(agent); const captured: unknown[] = []; owner.onToolObservation(value => captured.push(value.result?.value));
    expect(await agent.tools.execute('actual', {})).toBe(raw); expect(captured).toEqual([raw]); owner.release();
  });

  it('preflights an unsupported nested option before any deterministic action', () => {
    const { agent } = make(); const execute = vi.fn(async () => true);
    agent.tools.register({ definition: { type: 'function', function: { name: 'submit', parameters: { type: 'object', properties: {} } } }, execute });
    const definition = createRoutineDefinition({ name: 'Nested preflight', description: 'Fixture', preSteps: [{ name: 'submit', toolName: 'submit', args: {} }],
      tasks: [{ name: 'group', description: 'Work', controlFlow: { type: 'map', source: 'items', tasks: [{ name: 'leaf', description: 'Work', maxAttempts: 2 }] } }] });
    expect(() => preflightRoutine(definition, agent)).toThrow(/maxAttempts/); expect(execute).not.toHaveBeenCalled();
  });

  it('retains an over-capacity exact source and accepts only a valid correlated archive assertion', () => {
    const observations = new RoutineObservations('operation', 8192); const raw = { id: 'actual', body: 'body'.repeat(6000) };
    const source = observations.retain('tool', raw); expect(observations.source(source, true).data).toBeUndefined();
    expect(observations.hasPending).toBe(true); expect(observations.read(source, 40_000)).toEqual(raw);
    expect(() => observations.acknowledge('foreign', reference('stored'))).toThrow(/Unknown/);
    expect(() => observations.acknowledge(source, { ...reference('stored'), sha256: 'invalid' })).toThrow(/Invalid/);
    expect(observations.hasPending).toBe(true); observations.acknowledge(source, reference('stored'));
    expect(observations.hasPending).toBe(false); expect(observations.source(source).retained).toBe('evidence');
  });

  it('archives an oversized phase once, keeping exact data and late sources through view reduction', () => {
    const observations = new RoutineObservations('operation', 8192);
    const candidate: RoutineObservation = { operationId: 'operation', phase: 'task', taskId: 'task', reason: 'settled',
      tasks: [], toolOutcomes: [], stepOutcomes: [], sources: [], complete: true,
      response: { id: 'response', object: 'response', model: 'fixture', created_at: 1, status: 'completed', output: [], output_text: 'source'.repeat(5000) } };
    const reduced = observations.view('task', candidate); expect(reduced.complete).toBe(false);
    const source = reduced.sources[0]!; expect(observations.read(source.id, 40_000)).toMatchObject({ current: candidate });
    const late = observations.retain('tool', { id: 'late' }); observations.requireArchive(late);
    observations.acknowledge(source.id, reference('archive'));
    expect(observations.read(late)).toEqual({ id: 'late' }); expect(observations.hasPending).toBe(true);
    observations.acknowledge(late, reference('late-archive'));
    expect(observations.view('task', { ...candidate, reason: 'reconcile' }).complete).toBe(true);
    expect(observations.observations()).toHaveLength(1); expect(observations.observations()[0]!.response).toBeUndefined();
  });
});
