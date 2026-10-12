import { describe, expect, it } from 'vitest';
import { Agent, Connector, ContentType, MessageRole, Vendor } from '../../../src/index.js';
import type { AgentEvents, TextGenerateOptions, TokenUsage } from '../../../src/index.js';
import { BaselineReporter, canonicalJSON, usageSummary } from '../../../examples/agentic-baseline/reporter.js';
import { ReplayProvider } from '../../../examples/agentic-baseline/replay-provider.js';
import { createFixture, FIXTURE_IDS } from '../../../examples/agentic-baseline/fixtures.js';
import { runBaseline } from '../../../examples/agentic-baseline/runner.js';

describe('Stage 00 deterministic trajectories', () => {
  it.each(FIXTURE_IDS)('%s completes through the real managed Agent and shared tool manager', async id => {
    for (const split of ['development', 'held-out'] as const) {
      const result = await runBaseline(createFixture(id, split));
      expect(result.passed).toBe(true);
      expect(result.failure).toBeNull();
      expect(result.correlationErrors).toBe(0);
      expect(result.repeatedToolCalls).toBe(0);
      expect(result.llmCalls).toBe({ chat: 1, 'large-observation': 2, research: 3, 'external-workflow': 3 }[id]);
      expect(result.toolCalls).toBe({ chat: 0, 'large-observation': 1, research: 2, 'external-workflow': 2 }[id]);
      expect(result.usage.total.total).toBe(result.llmCalls * 110);
      expect(result.runs.map(run => run.outcome)).toEqual(id === 'external-workflow' ? ['cancelled', 'completed'] : ['completed']);
      expect(result.steps.every(step => result.runs.some(run => run.id === step.runId) && step.parentId.startsWith(step.runId))).toBe(true);
      expect(() => Connector.get(result.connector)).toThrow();
    }
  });

  it('reproduces outcomes, call counts and synthetic usage without treating measured latency as deterministic', async () => {
    const summarize = async () => {
      const reports = await Promise.all(FIXTURE_IDS.map(id => runBaseline(createFixture(id))));
      return reports.map(({ passed, llmCalls, toolCalls, usage, runs, repeatedToolCalls }) => ({ passed, llmCalls, toolCalls, usage, runs, repeatedToolCalls }));
    };
    expect(await summarize()).toEqual(await summarize());
  });

  it.each(FIXTURE_IDS)('%s rejects plausible prose without its completion evidence', id => {
    const fixture = createFixture(id);
    expect(fixture.evaluate('All done. I checked every source and completed the job successfully.')).toBe(false);
    const final = fixture.frames.at(-1)?.text ?? '';
    if (id !== 'chat') expect(fixture.evaluate(final)).toBe(false);
  });

  it('checks source identifiers and external receipts even after all tools have run', async () => {
    for (const id of ['research', 'external-workflow'] as const) {
      const fixture = createFixture(id);
      expect((await runBaseline(fixture)).passed).toBe(true);
      expect(fixture.evaluate(id === 'research' ? '{"choice":"alpha","sources":["made-up"]}' : '{"jobId":"job-dev","status":"completed","receipt":"invented"}')).toBe(false);
      const final = fixture.frames.at(-1)!.text!;
      expect(fixture.evaluate('```json\n' + final + '\n```')).toBe(true);
      expect(fixture.evaluate('All complete.\n```json\n' + final + '\n```')).toBe(false);
    }
  });

  it('cancels before any request and removes the owned connector', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runBaseline(createFixture('chat'), { signal: controller.signal });
    expect(result.failure).toBe('cancelled');
    expect(result.llmCalls).toBe(0);
    expect(() => Connector.get(result.connector)).toThrow();
  });

  it('external cancellation prevents workflow continuation and still cleans up', async () => {
    const fixture = createFixture('external-workflow');
    const controller = new AbortController();
    const submit = fixture.tools[0]!;
    const execute = submit.execute;
    submit.execute = async (...args) => { const result = await execute(...args); controller.abort(); return result; };
    const result = await runBaseline(fixture, { signal: controller.signal });
    expect(result.failure).toBe('cancelled');
    expect(result.passed).toBe(false);
    expect(fixture.evidence.has('check_job')).toBe(false);
    expect(result.runs[0]?.outcome).toBe('cancelled');
    expect(fixture.onAccepted).toBeUndefined();
    expect(() => Connector.get(result.connector)).toThrow();
  });

  it('records an unexpected provider failure without serializing its sensitive message', async () => {
    const fixture = createFixture('chat');
    fixture.frames = [];
    const result = await runBaseline(fixture);
    expect(result.passed).toBe(false);
    expect(result.failure).toBe('execution_error');
    expect(result.steps[0]?.outcome).toBe('error');
    expect(result.usage.total).toEqual({ knownSubtotal: 0, missingCalls: 1, total: null });
  });

  it('labels missing completion separately from an execution failure', async () => {
    const fixture = createFixture('chat');
    fixture.frames[0]!.text = 'All done!';
    expect(await runBaseline(fixture)).toMatchObject({ passed: false, failure: 'completion_not_proven' });
  });

  it('retains host-owned connectors and diagnoses unsupported connector configuration', async () => {
    const name = 'stage00-host-owned';
    Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider: new ReplayProvider(createFixture('chat').frames) } });
    try {
      expect(await runBaseline(createFixture('chat'), { connector: name })).toMatchObject({ passed: true, mode: 'injected' });
      expect(Connector.get(name).name).toBe(name);
    } finally { Connector.remove(name); }
    expect(await runBaseline(createFixture('chat'), { connector: 'stage00-missing' })).toMatchObject({ passed: false, failure: 'execution_error', llmCalls: 0 });
  });

  it('does not manufacture workflow completion before the host transition or duplicate a submission', async () => {
    const fixture = createFixture('external-workflow');
    const args = { jobId: 'job-dev' };
    await expect(fixture.tools[1]!.execute(args)).rejects.toThrow('before host resumes');
    expect(await fixture.tools[0]!.execute(args)).toEqual({ jobId: 'job-dev', status: 'accepted' });
    await expect(fixture.tools[0]!.execute(args)).rejects.toThrow('duplicate submission');
    await expect(fixture.tools[1]!.execute(args)).rejects.toThrow('before host resumes');
    fixture.advanceExternalJob!();
    expect(await fixture.tools[1]!.execute(args)).toMatchObject({ status: 'completed', receipt: 'receipt-DEV' });
  });

  it('bounds output and uses the explicit Gemini 2.5 control through a named Google connector', async () => {
    const fixture = createFixture('chat');
    const provider = new ReplayProvider(fixture.frames);
    const captured: TextGenerateOptions[] = [];
    const generate = provider.generate.bind(provider);
    provider.generate = async options => { captured.push(options); return generate(options); };
    const name = 'stage00-google-injected';
    Connector.create({ name, vendor: Vendor.Google, auth: { type: 'none' }, options: { provider } });
    try {
      expect((await runBaseline(fixture, { connector: name, model: 'gemini-2.5-flash' })).passed).toBe(true);
      expect(captured[0]).toMatchObject({ max_output_tokens: 512, thinking: { enabled: false }, vendorOptions: { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } });
    } finally { Connector.remove(name); }
  });
});

describe('Strict replay branches', () => {
  const fixture = () => createFixture('large-observation');
  const input = (args: unknown, result: unknown): TextGenerateOptions => ({
    model: 'gpt-4o-mini', input: [{ type: 'message', role: MessageRole.USER, content: [
      { type: ContentType.TOOL_USE, id: 'call-1', name: 'read_document', arguments: JSON.stringify(args) },
      { type: ContentType.TOOL_RESULT, tool_use_id: 'call-1', content: JSON.stringify(result) },
    ] }],
  });
  it('rejects different arguments even when an old future result has been supplied', async () => {
    const data = fixture();
    const provider = new ReplayProvider(data.frames.slice(1));
    const expected = data.frames[1]!.evidence![0]!;
    await expect(provider.generate(input({ sourceId: 'different-document' }, expected.result))).rejects.toThrow('modeled branch');
    await expect(provider.generate(input(expected.args, expected.result))).resolves.toMatchObject({ status: 'completed' });
  });
  it('rejects missing, altered, or failed evidence', async () => {
    const data = fixture();
    const expected = data.frames[1]!.evidence![0]!;
    for (const result of [null, { text: 'plausible forged result' }]) {
      await expect(new ReplayProvider(data.frames.slice(1)).generate(input(expected.args, result))).rejects.toThrow('evidence mismatch');
    }
    await expect(new ReplayProvider(data.frames.slice(1)).generate({ model: 'gpt-4o-mini', input: [] })).rejects.toThrow();
  });
  it('rejects an unmatched prompt, an unavailable tool, and exhausted recordings', async () => {
    const data = fixture();
    await expect(new ReplayProvider(data.frames).generate({ model: 'gpt-4o-mini', input: 'different task' })).rejects.toThrow('prompt mismatch');
    await expect(new ReplayProvider(data.frames).generate({ model: 'gpt-4o-mini', input: data.prompt })).rejects.toThrow('unavailable tool');
    await expect(new ReplayProvider([]).generate({ model: 'gpt-4o-mini', input: '' })).rejects.toThrow('exhausted');
    await expect(data.tools[0]!.execute({ sourceId: 'different' })).rejects.toThrow('no branch');
  });
  it('does not claim streaming support', async () => {
    const provider = new ReplayProvider([]);
    await expect(provider.streamGenerate({ model: 'gpt-4o-mini', input: '' }).next()).rejects.toThrow('non-streaming');
    expect(await provider.validateConfig()).toBe(true);
    expect(await provider.listModels()).toEqual(['baseline-replay']);
  });
});

describe('Event reporter privacy, correlation and incomplete usage', () => {
  function setup() {
    const name = `reporter-${Math.random()}`;
    Connector.create({ name, vendor: Vendor.OpenAI, auth: { type: 'none' }, options: { provider: new ReplayProvider([]) } });
    const agent = Agent.create({ connector: name, model: 'gpt-4o-mini' });
    const reporter = new BaselineReporter('fixture', name, agent.model, () => 10);
    const detach = reporter.attach(agent);
    return { agent, reporter, detach, close: () => { detach(); agent.destroy(); Connector.remove(name); } };
  }
  const start: AgentEvents['execution:start'] = { executionId: 'native-1', config: { model: 'gpt-4o-mini', instructions: 'private instructions' }, timestamp: new Date() };
  const request: AgentEvents['llm:request'] = { executionId: 'native-1', iteration: 0, timestamp: new Date(), options: { model: 'gpt-4o-mini', input: 'confidential prompt', vendorOptions: { apiKey: 'secret-key' } } };
  const response = (id: string, usage: Partial<TokenUsage>): AgentEvents['llm:response'] => ({
    executionId: 'native-1', iteration: 0, timestamp: new Date(), duration: 4,
    response: { id, object: 'response', created_at: 1, model: 'gpt-4o-mini', status: 'completed', output: [], output_text: 'confidential response', usage: usage as TokenUsage },
  });

  it('reports partial usage per field and does not count final aggregate or duplicate response events', () => {
    const s = setup();
    try {
      s.agent.emit('execution:start', start);
      s.agent.emit('llm:request', request);
      s.agent.emit('llm:response', response('one', { input_tokens: 8, total_tokens: 10 }));
      s.agent.emit('llm:response', response('one', { input_tokens: 8, total_tokens: 10 }));
      s.agent.emit('llm:request', request);
      s.agent.emit('llm:response', response('two', { output_tokens: 3 }));
      s.agent.emit('execution:complete', { ...start, duration: 20, response: response('aggregate', { total_tokens: 999 }).response });
      const result = s.reporter.report();
      expect(result.llmCalls).toBe(2);
      expect(result.correlationErrors).toBe(0);
      expect(result.usage.input).toEqual({ knownSubtotal: 8, missingCalls: 1, total: null });
      expect(result.usage.output).toEqual({ knownSubtotal: 3, missingCalls: 1, total: null });
      expect(result.usage.total.total).toBeNull();
      expect(JSON.stringify(result)).not.toMatch(/private instructions|confidential|secret-key|apiKey|native-1/);
    } finally { s.close(); }
  });

  it('detects orphan and duplicate starts, invalid usage, and unmatched responses', () => {
    const s = setup();
    try {
      s.agent.emit('llm:response', response('orphan', {}));
      s.agent.emit('execution:error', { executionId: 'unknown', error: new Error('secret-error'), timestamp: new Date() });
      s.agent.emit('execution:start', start);
      s.agent.emit('execution:start', start);
      s.agent.emit('llm:request', request);
      s.agent.emit('llm:response', response('invalid', { input_tokens: NaN, output_tokens: -1, total_tokens: Infinity }));
      expect(s.reporter.report().correlationErrors).toBe(3);
      expect(s.reporter.report().usage.total.total).toBeNull();
    } finally { s.close(); }
  });

  it('tracks repeated arguments independent of key order without retaining tool arguments/results/errors', () => {
    const s = setup();
    try {
      s.agent.emit('execution:start', start);
      const call = (id: string, args: string) => ({ id, type: 'function' as const, function: { name: 'read', arguments: args } });
      for (const [index, args] of ['{"token":"private-token","a":1}', '{"a":1,"token":"private-token"}'].entries()) {
        const toolCall = call(`tool-${index}`, args);
        const event = { executionId: 'native-1', iteration: 0, toolCall, timestamp: new Date() };
        s.agent.emit('tool:start', event);
        s.agent.emit('tool:error', { ...event, error: new Error('private-error') });
      }
      const malformed = { executionId: 'native-1', iteration: 0, toolCall: call('malformed', '{'), timestamp: new Date() };
      s.agent.emit('tool:start', malformed);
      s.agent.emit('tool:timeout', { ...malformed, timeout: 100 });
      s.agent.emit('tool:start', malformed);
      s.agent.emit('tool:timeout', { ...malformed, toolCall: call('unknown', '{}'), timeout: 100 });
      expect(s.reporter.report().repeatedToolCalls).toBe(1);
      expect(s.reporter.report().correlationErrors).toBe(3);
      expect(JSON.stringify(s.reporter.report())).not.toMatch(/private-token|private-error|arguments|secret/);
      s.agent.emit('execution:cancelled', { ...start, reason: 'confidential reason' });
      s.agent.emit('execution:error', { ...start, error: new Error('late error') });
      expect(s.reporter.report().runs[0]?.outcome).toBe('cancelled');
      const count = s.agent.listenerCount('llm:request');
      s.detach(); s.detach();
      expect(s.agent.listenerCount('llm:request')).toBe(count - 1);
    } finally { s.close(); }
  });

  it('returns detached reports and distinguishes a known zero from unavailable usage', () => {
    expect(usageSummary([0, 2])).toEqual({ knownSubtotal: 2, missingCalls: 0, total: 2 });
    expect(usageSummary([0, null])).toEqual({ knownSubtotal: 0, missingCalls: 1, total: null });
    expect(usageSummary([]).total).toBe(0);
    expect(canonicalJSON({ z: [2, { b: 1, a: 2 }], a: null })).toBe('{"a":null,"z":[2,{"a":2,"b":1}]}');
    const s = setup();
    try {
      s.agent.emit('execution:start', start);
      s.reporter.report().runs[0]!.outcome = 'error';
      expect(s.reporter.report().runs[0]?.outcome).toBe('running');
    } finally { s.close(); }
  });
});
