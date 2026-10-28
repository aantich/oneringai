import dotenv from 'dotenv';
import { describe, expect, it } from 'vitest';
import { Connector, ModelTask, Vendor, StreamEventType, createOrchestratorWithFactory } from '../../../src/index.js';
import type { ChildObservation } from '../../../src/index.js';
dotenv.config({ quiet: true });
const enabled = process.env.RUN_ORCHESTRATOR_FACTORY_LIVE === '1';
const providers = [
  { name: 'openai', vendor: Vendor.OpenAI, key: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini' },
  { name: 'anthropic', vendor: Vendor.Anthropic, key: process.env.ANTHROPIC_API_KEY, model: 'claude-haiku-4-5-20251001' },
  { name: 'google', vendor: Vendor.Google, key: process.env.GOOGLE_API_KEY, model: 'gemini-2.5-flash' },
];
describe.skipIf(!enabled).sequential('C6 complete factory with real cross-vendor children', () => {
  for (const [index, provider] of providers.entries()) for (const mode of ['run', 'stream'] as const) it(`${provider.name}/${mode}: effective worker provider and active monitor share this operation only`, async () => {
    const worker = providers[(index + 1) % providers.length]!; if (!provider.key || !worker.key) throw new Error('Required live credential missing');
    const rootName = `c6-${provider.name}-${mode}`, workerName = `${rootName}-child`, reports: ChildObservation[] = [];
    Connector.create({ name: rootName, vendor: provider.vendor, auth: { type: 'api_key', apiKey: provider.key } });
    Connector.create({ name: workerName, vendor: worker.vendor, auth: { type: 'api_key', apiKey: worker.key } });
    const task = new ModelTask({ limits: { maxCalls: 2 } });
    const parent = await createOrchestratorWithFactory({ connector: rootName, model: provider.model, agentTypes: { specialist: { systemPrompt: 'A bounded local exercise.' } } }, {
      configureAgent: ({ role }) => ({ connector: role === 'parent' ? rootName : workerName, model: role === 'parent' ? provider.model : worker.model,
        instructions: role === 'parent' ? 'You monitor a delegation. Always return only continue, without punctuation.' : 'This is a literal echo connectivity test. Reply with exactly C6_CHILD_VERIFIED. No lookup, workspace operation or external action is needed.',
        temperature: 0, thinking: { enabled: false }, permissions: { autoApproveAll: true }, identities: [], userId: role === 'parent' ? 'live-host' : 'live-worker',
        asyncTools: { autoContinue: false }, emptyResponseRetry: { enabled: false }, modelExecution: { maxOutputTokensPerCall: 128 },
        hooks: { 'before:llm': async hook => { hook.options.tools = []; delete hook.options.tool_choice; return {}; } },
        context: { model: role === 'parent' ? provider.model : worker.model, responseReserve: role === 'parent' ? 256 : 128, features: { workingMemory: false, inContextMemory: false } } }),
      onChildOutcome: report => { reports.push(report); },
    });
    try {
      const admitted = await parent.tools.executeWithOutcome('delegate_interactive', { agent: 'specialist-1', type: 'specialist', monitoring: 'active' }); expect(admitted.outcome.status).toBe('succeeded');
      const input = 'For this connectivity check, echo the exact literal C6_CHILD_VERIFIED. No data lookup or action is required.';
      let text = ''; if (mode === 'run') text = (await parent.run(input, { modelTask: task })).output_text ?? '';
      else for await (const event of parent.stream(input, { modelTask: task })) if (event.type === StreamEventType.OUTPUT_TEXT_DELTA) text += event.delta;
      await new Promise<void>(resolve => setImmediate(resolve)); expect(text).toContain('C6_CHILD_VERIFIED'); expect(task.snapshot().totals.calls).toBe(2);
      expect(task.snapshot().invocations.map(invocation => invocation.connector)).toEqual([workerName, rootName]);
      expect(task.snapshot().invocations.every(invocation => invocation.status === 'succeeded')).toBe(true);
      expect(reports).toHaveLength(1); expect(reports[0]?.accounting).toBe('shared'); expect(reports[0]?.modelTaskId).toBe(task.id); expect(task.signal.aborted).toBe(false);
    } catch (error) { const diagnostic = { type: error instanceof Error ? error.name : 'unknown',
        code: error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined,
        assertion: error instanceof Error && error.name === 'AssertionError' ? error.message : undefined,
        calls: task.snapshot().invocations.map(call => ({ model: call.model, status: call.status, parentInvocationId: call.parentInvocationId })) };
      throw new Error(`C6 ${provider.name}/${mode}: ${JSON.stringify(diagnostic)}; credentials omitted`); }
    finally { parent.destroy(); task.destroy(); Connector.remove(rootName); Connector.remove(workerName); }
  }, 90_000);
});
