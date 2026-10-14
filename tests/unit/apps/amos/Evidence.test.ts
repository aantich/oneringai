import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent, Connector, Vendor, ContentType, MessageRole, StreamEventType, FileEvidenceStorage, FileContextStorage, EvidencePluginNextGen, InMemoryEvidenceStorage } from '@everworker/oneringai';
import type { ToolExecutionOutcome, ITextProvider } from '@everworker/oneringai';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentRunner } from '../../../../apps/amos/src/agent/AgentRunner.js';
import { ContextCommand } from '../../../../apps/amos/src/commands/commands/ContextCommand.js';
import { describeToolOutcome } from '../../../../apps/amos/src/agent/toolOutcomes.js';
import { DEFAULT_CONFIG } from '../../../../apps/amos/src/config/types.js';
import type { CommandContext, IAgentRunner } from '../../../../apps/amos/src/config/types.js';
afterEach(() => vi.restoreAllMocks());
describe('AMOS evidence inspection and effect diagnostics', () => {
  it.each(['run', 'stream'] as const)('%s saves and reloads interrupted observations through the real runner without executing again', async mode => {
    const directory = await mkdtemp(join(tmpdir(), 'amos-retained-')); let calls = 0, executions = 0;
    const provider: ITextProvider = { name: 'fixture', capabilities: { text: true, images: false, audio: false, videos: false }, validateConfig: async () => true, listModels: async () => [],
      getModelCapabilities: () => ({ supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: true, maxTokens: 128000, maxOutputTokens: 1024 }),
      generate: async () => { if (++calls > 1) throw new Error('interrupted'); return { id: 'r', object: 'response', created_at: 1, model: 'gpt-4o-mini', status: 'completed', output_text: '', output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'call', name: 'probe', arguments: '{}' }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }; },
      async *streamGenerate() { calls++; yield { type: StreamEventType.TOOL_CALL_START, response_id: 'r', item_id: 'tool', tool_call_id: 'call', tool_name: 'probe' }; yield { type: StreamEventType.TOOL_CALL_ARGUMENTS_DONE, response_id: 'r', tool_call_id: 'call', tool_name: 'probe', arguments: '{}' }; yield { type: StreamEventType.RESPONSE_COMPLETE, response_id: 'r', status: 'completed', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, iterations: 1 }; } };
    Connector.create({ name: 'amos-retention', vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider } });
    const config = structuredClone(DEFAULT_CONFIG); config.session.autoSave = false; config.permissions.allowlist = ['probe']; config.evidence = { enabled: true, ownerId: 'local', namespace: 'retention', directory: join(directory, 'evidence') };
    vi.spyOn(FileEvidenceStorage.prototype, 'put').mockRejectedValue(new Error('offline'));
    const runner = new AgentRunner(config, [{ definition: { type: 'function', function: { name: 'probe', parameters: { type: 'object', properties: {} } } }, execute: async () => { executions++; return { source: 'AMOS_PENDING_SOURCE' }; } }], join(directory, 'sessions'));
    try {
      await runner.initialize('amos-retention', 'gpt-4o-mini'); if (mode === 'run') await expect(runner.run('once')).rejects.toThrow('interrupted'); else for await (const event of runner.stream('once')) if (event.type === 'tool:complete') break; const id = await runner.saveSession();
      const sessions = new FileContextStorage({ agentId: 'amos', baseDirectory: join(directory, 'sessions') }); expect(JSON.stringify((await sessions.load(id))?.state)).toContain('AMOS_PENDING_SOURCE');
      await runner.loadSession(id); await runner.saveSession(); expect(JSON.stringify((await sessions.load(id))?.state)).toContain('storage_failed'); expect(executions).toBe(1); expect(calls).toBe(mode === 'run' ? 2 : 1);
    } finally { runner.destroy(); Connector.remove('amos-retention'); await rm(directory, { recursive: true, force: true }); }
  });
  it('keeps configuration disabled by default', () => { expect(DEFAULT_CONFIG.evidence).toBeUndefined(); });
  it('shows evidence storage/projection failure separately from successful tool execution', () => {
    const base: ToolExecutionOutcome = { executionId: 'e', toolName: 'write', status: 'succeeded', startedAt: 1, durationMs: 2, executionStarted: true, completion: 'settled', cancellation: 'none' };
    expect(describeToolOutcome({ ...base, evidence: { status: 'storage_failed', effect: 'write' } })).toContain('tool execution succeeded; evidence storage failed');
    expect(describeToolOutcome({ ...base, evidence: { status: 'projection_failed', effect: 'write' } })).toContain('evidence stored, projection failed');
    expect(describeToolOutcome({ ...base, status: 'cancelled', completion: 'unknown' })).toContain('Check external state before retrying');
  });
  it('parses bounded previews and rejects invalid offsets without invoking the runner', async () => {
    const inspectEvidence = vi.fn(async () => 'metadata'); const runner = { isReady: () => true, inspectEvidence } as unknown as IAgentRunner;
    const app = { getAgent: () => runner } as CommandContext['app']; const command = new ContextCommand();
    const invoke = (args: string[]) => command.execute({ app, args, rawInput: `/context ${args.join(' ')}` });
    expect((await invoke(['evidence'])).success).toBe(true); expect(inspectEvidence).toHaveBeenLastCalledWith(undefined, 0);
    expect((await invoke(['evidence', 'id', '1024'])).success).toBe(true); expect(inspectEvidence).toHaveBeenLastCalledWith('id', 1024);
    inspectEvidence.mockClear(); for (const args of [['evidence', 'id', '-1'], ['evidence', 'id', 'NaN'], ['evidence', 'id', '1', 'extra']]) expect((await invoke(args)).success).toBe(false);
    expect(inspectEvidence).not.toHaveBeenCalled();
  });
  it('reports inaccessible/corrupt storage without printing backend exception contents', async () => {
    const runner = { isReady: () => true, inspectEvidence: async () => { throw new Error('SENSITIVE_BACKEND_ERROR'); } } as unknown as IAgentRunner;
    const command = new ContextCommand(); const result = await command.execute({ app: { getAgent: () => runner } as CommandContext['app'], args: ['evidence'], rawInput: '/context evidence' });
    expect(result.success).toBe(false); expect(result.message).not.toContain('SENSITIVE_BACKEND_ERROR');
  });
  it('lists metadata only and requires an explicit ID for a bounded preview', async () => {
    const storage = new InMemoryEvidenceStorage({ scope: { ownerId: 'local', namespace: 'amos' } });
    const plugin = new EvidencePluginNextGen({ storage }); const ref = await storage.put({ version: 1, recordedAt: 1,
      source: { toolName: 'probe', executionId: 'e', arguments: {}, principal: {}, effect: 'read', status: 'succeeded', completion: 'settled', startedAt: 1, durationMs: 1 }, result: { privateText: 'PRIVATE_SOURCE_03'.repeat(1000) } });
    const fake = { context: { getPlugin: () => plugin }, destroy: vi.fn() }; vi.spyOn(Agent, 'create').mockReturnValue(fake as unknown as Agent);
    const config = structuredClone(DEFAULT_CONFIG); const runner = new AgentRunner(config, []); await runner.initialize('mock', 'gpt-4o-mini');
    try {
      const listing = await runner.inspectEvidence(); expect(listing).toContain(ref.id); expect(listing).not.toContain('PRIVATE_SOURCE_03');
      const preview = await runner.inspectEvidence(ref.id); expect(preview.length).toBeLessThan(1100); expect(preview).toContain('Next offset: 1024');
      await expect(runner.inspectEvidence('../../escape')).rejects.toThrow('Invalid evidence'); expect(await runner.inspectEvidence('00000000-0000-4000-8000-000000000000')).toBe('Evidence missing or expired.');
    } finally { runner.destroy(); }
  });
});
