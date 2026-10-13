import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { Agent } from '@/core/Agent.js';
import { Connector } from '@/core/Connector.js';
import { Vendor } from '@/core/Vendor.js';
import { ContentType } from '@/domain/entities/Content.js';
import { MessageRole } from '@/domain/entities/Message.js';
import { StreamEventType } from '@/domain/entities/StreamEvent.js';
import { ProviderError } from '@/domain/errors/AIErrors.js';
import type { TextGenerateOptions } from '@/domain/interfaces/ITextProvider.js';
import type { ToolFunction } from '@/domain/entities/Tool.js';
import { AnthropicConverter } from '@/infrastructure/providers/anthropic/AnthropicConverter.js';

const sdk = vi.hoisted(() => ({ stream: vi.fn(), create: vi.fn(), abort: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn(function () {
  return { messages: { stream: sdk.stream, create: sdk.create } };
}) }));

const model = 'claude-haiku-4-5-20251001';
const agents: Agent[] = [];
const definition = (name: string): ToolFunction['definition'] => ({
  type: 'function', function: { name, parameters: { type: 'object', properties: {}, additionalProperties: false } },
});
const definitions = [definition('selected'), definition('other')];
const choice = { type: 'function' as const, function: { name: 'selected' } };
const usage = { input_tokens: 10, output_tokens: 5 };

function message(names: string[]): Anthropic.Message {
  return { id: 'message', type: 'message', role: 'assistant', model,
    content: names.length ? names.map((name, index) => ({ type: 'tool_use', id: `call-${index}`, name, input: {} }))
      : [{ type: 'text', text: 'DOMAIN_VALID' }],
    stop_reason: names.length ? 'tool_use' : 'end_turn', stop_sequence: null, usage,
  } as Anthropic.Message;
}

function stream(names: string[]) {
  return { controller: { abort: sdk.abort }, async *[Symbol.asyncIterator]() {
    yield { type: 'message_start', message: { ...message([]), content: [], stop_reason: null } };
    if (names.length) {
      for (const [index, name] of names.entries()) {
        yield { type: 'content_block_start', index,
          content_block: { type: 'tool_use', id: `call-${index}`, name, input: {} } };
        yield { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: '{}' } };
        yield { type: 'content_block_stop', index };
      }
    } else {
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'DOMAIN_VALID' } };
      yield { type: 'content_block_stop', index: 0 };
    }
    yield { type: 'message_delta', delta: { stop_reason: names.length ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 5 } };
    yield { type: 'message_stop' };
  } };
}

function fixture(mode: 'run' | 'stream', returnedNames: string[], forceChoice = true) {
  const selected = vi.fn(async () => ({ success: false, marker: 'DOMAIN_VALID' }));
  const other = vi.fn(async () => 'OTHER_VALUE');
  let requests = 0;
  const agent = Agent.create({ connector: 'named-tool-fixture', model, maxIterations: 3,
    tools: [{ definition: definitions[0]!, execute: selected }, { definition: definitions[1]!, execute: other }],
    thinking: { enabled: false }, emptyResponseRetry: { enabled: false },
    context: { model, features: { workingMemory: false, inContextMemory: false } },
    hooks: { 'before:llm': async context => {
      context.options.max_output_tokens = 128;
      context.options.tool_choice = requests++ === 0 && forceChoice ? choice : 'auto';
      return {};
    } },
  });
  agents.push(agent);
  sdk.stream.mockImplementationOnce(() => ({ controller: { abort: sdk.abort }, finalMessage: async () => message(returnedNames) }))
    .mockImplementation(() => ({ controller: { abort: sdk.abort }, finalMessage: async () => message([]) }));
  sdk.create.mockResolvedValueOnce(stream(returnedNames)).mockImplementation(async () => stream([]));
  const events: Array<{ type: string }> = [];
  const run = async () => {
    if (mode === 'run') return agent.run('Use the selected tool.');
    for await (const event of agent.stream('Use the selected tool.')) events.push(event);
    return undefined;
  };
  return { agent, selected, other, events, run, request: mode === 'run' ? sdk.stream : sdk.create };
}

beforeEach(() => {
  sdk.stream.mockReset(); sdk.create.mockReset(); sdk.abort.mockReset();
  Connector.create({ name: 'named-tool-fixture', vendor: Vendor.Anthropic, auth: { type: 'api_key', apiKey: 'offline-fixture' } });
});
afterEach(() => { agents.splice(0).forEach(agent => agent.destroy()); Connector.remove('named-tool-fixture'); });

describe('Anthropic named-tool request conversion', () => {
  it('narrows only explicitly selected local definitions and preserves their metadata without mutating input', () => {
    const options: TextGenerateOptions = { model, input: 'probe', tool_choice: choice, parallel_tool_calls: false,
      tools: [{ ...definition('selected'), function: { ...definition('selected').function, strict: true }, deferLoading: true, allowedCallers: ['direct'] }, definition('other')] };
    const original = structuredClone(options);
    const request = new AnthropicConverter().convertRequest(options);
    expect(request.tools).toHaveLength(1);
    expect(request.tools![0]).toMatchObject({ name: 'selected', strict: true, defer_loading: true, allowed_callers: ['direct'] });
    expect(request.tool_choice).toEqual({ type: 'tool', name: 'selected', disable_parallel_tool_use: true });
    expect(options).toEqual(original);
  });

  it.each([undefined, 'auto', 'required'] as const)('preserves all tools for choice %s', toolChoice => {
    const request = new AnthropicConverter().convertRequest({ model, input: 'probe', tools: definitions, tool_choice: toolChoice });
    expect(request.tools?.map(tool => 'name' in tool ? tool.name : undefined)).toEqual(['selected', 'other']);
  });

  it('retains native tool configuration and replay of a previously called local tool', () => {
    const input: TextGenerateOptions['input'] = [
      { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.INPUT_TEXT, text: 'Earlier probe' }] },
      { type: 'message', role: MessageRole.ASSISTANT, content: [{ type: ContentType.TOOL_USE, id: 'old-call', name: 'other', arguments: '{}' }] },
      { type: 'message', role: MessageRole.USER, content: [{ type: ContentType.TOOL_RESULT, tool_use_id: 'old-call', content: 'old result' }] },
    ];
    const request = new AnthropicConverter().convertRequest({ model: 'claude-sonnet-4-6', input,
      tools: definitions, tool_choice: choice, native_tools: [{ capability: 'web_fetch' }] });
    expect(request.tools?.map(tool => 'name' in tool ? tool.name : undefined)).toEqual(['selected', 'web_fetch']);
    expect(JSON.stringify(request.messages)).toContain('other');
    expect(JSON.stringify(request.messages)).toContain('old result');
  });

  it('preserves existing remote validation for an unknown selected tool', () => {
    const request = new AnthropicConverter().convertRequest({ model, input: 'probe', tools: definitions,
      tool_choice: { type: 'function', function: { name: 'unknown' } } });
    expect(request.tools).toHaveLength(2);
    expect(request.tool_choice).toEqual({ type: 'tool', name: 'unknown' });
  });

  it('does not apply a suppressed named choice during on-demand compaction', () => {
    const request = new AnthropicConverter().convertRequest({ model, input: 'probe', tools: definitions,
      tool_choice: choice, vendorOptions: { compaction: true } });
    expect(request.tool_choice).toBeUndefined();
    expect(request.tools).toHaveLength(2);
  });
});

describe('Anthropic named-tool execution boundary', () => {
  it.each(['run', 'stream'] as const)('%s selects the requested tool and preserves business-data success and later auto choice', async mode => {
    const f = fixture(mode, ['selected']);
    await f.run();
    expect(f.request.mock.calls[0]![0].tools.map((tool: { name: string }) => tool.name)).toEqual(['selected']);
    expect(f.request.mock.calls[1]![0].tools.map((tool: { name: string }) => tool.name)).toEqual(['selected', 'other']);
    expect(f.selected).toHaveBeenCalledTimes(1); expect(f.other).not.toHaveBeenCalled();
    expect(f.agent.getMetrics()).toMatchObject({ toolCallCount: 1, toolSuccessCount: 1, toolFailureCount: 0 });
    expect(JSON.stringify(f.agent.context.getState())).toContain('DOMAIN_VALID');
    expect(f.agent.tools).toBe(f.agent.context.tools);
  });

  it.each(['run', 'stream'] as const)('%s rejects a mismatched call before tools/history, without retry, and cleans up for the next run', async mode => {
    const f = fixture(mode, ['other']);
    const error = await f.run().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code: 'PROVIDER_ERROR', message: "anthropic: Named tool choice 'selected' returned unexpected tool 'other'" });
    expect(f.selected).not.toHaveBeenCalled(); expect(f.other).not.toHaveBeenCalled();
    expect(f.request).toHaveBeenCalledTimes(1); expect(sdk.abort).toHaveBeenCalledTimes(1);
    expect(f.agent.getMetrics()?.toolCallCount).toBe(0);
    expect(JSON.stringify(f.agent.context.getState())).not.toContain('OTHER_VALUE');
    expect(f.agent.isRunning()).toBe(false);
    expect(f.events.some(event => event.type === StreamEventType.TOOL_CALL_START || event.type === StreamEventType.TOOL_EXECUTION_START)).toBe(false);
    await f.run();
    expect(f.agent.isRunning()).toBe(false);
    expect(f.request).toHaveBeenCalledTimes(2);
  });

  it('rejects a streamed batch containing a later mismatched tool before executing even its valid call', async () => {
    const f = fixture('stream', ['selected', 'other']);
    await expect(f.run()).rejects.toThrow("unexpected tool 'other'");
    expect(f.selected).not.toHaveBeenCalled(); expect(f.other).not.toHaveBeenCalled();
    expect(sdk.abort).toHaveBeenCalledTimes(1);
    expect(f.agent.getMetrics()?.toolCallCount).toBe(0);
  });

  it.each(['run', 'stream'] as const)('%s preserves ordinary auto selection of a different registered tool', async mode => {
    const f = fixture(mode, ['other'], false);
    await f.run();
    expect(f.selected).not.toHaveBeenCalled(); expect(f.other).toHaveBeenCalledTimes(1);
    expect(f.agent.getMetrics()).toMatchObject({ toolCallCount: 1, toolSuccessCount: 1, toolFailureCount: 0 });
  });
});
