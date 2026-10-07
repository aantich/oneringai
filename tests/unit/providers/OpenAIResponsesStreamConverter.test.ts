import { describe, expect, it } from 'vitest';
import { OpenAIResponsesStreamConverter } from '@/infrastructure/providers/openai/OpenAIResponsesStreamConverter.js';
import { StreamEventType } from '@/domain/entities/StreamEvent.js';

async function* events(...items: any[]): AsyncIterable<any> {
  for (const item of items) yield item;
}

async function collect(source: AsyncIterable<unknown>): Promise<any[]> {
  const result = [];
  for await (const item of source) result.push(item);
  return result;
}

describe('OpenAIResponsesStreamConverter Astra extensions', () => {
  it('preserves async custom tool metadata and input', async () => {
    const converter = new OpenAIResponsesStreamConverter();
    const result = await collect(converter.convertStream(events(
      {
        type: 'response.created', sequence_number: 0,
        response: { id: 'resp_1', model: 'gpt-6-astra', created_at: 1 },
      },
      {
        type: 'response.output_item.added', sequence_number: 1, output_index: 0,
        item: {
          type: 'custom_tool_call', id: 'ct_1', call_id: 'call_1',
          name: 'shell', input: '', async: true,
        },
      },
      {
        type: 'response.custom_tool_call_input.delta', sequence_number: 2,
        output_index: 0, item_id: 'ct_1', delta: 'do work',
      },
      {
        type: 'response.output_item.done', sequence_number: 3, output_index: 0,
        item: {
          type: 'custom_tool_call', id: 'ct_1', call_id: 'call_1',
          name: 'shell', input: 'do work', async: true,
        },
      },
    )));

    expect(result).toContainEqual(expect.objectContaining({
      type: StreamEventType.TOOL_CALL_START,
      tool_call_id: 'call_1',
      tool_type: 'custom',
      async: true,
    }));
    expect(result).toContainEqual(expect.objectContaining({
      type: StreamEventType.TOOL_CALL_ARGUMENTS_DONE,
      arguments: 'do work',
      tool_type: 'custom',
      async: true,
    }));
  });

  it('surfaces steering as an incomplete terminal response', async () => {
    const converter = new OpenAIResponsesStreamConverter();
    const result = await collect(converter.convertStream(events({
      type: 'response.incomplete',
      sequence_number: 1,
      response: {
        id: 'resp_1', status: 'incomplete', incomplete_details: { reason: 'steered' },
        usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
      },
    })));
    expect(result).toEqual([expect.objectContaining({
      type: StreamEventType.RESPONSE_COMPLETE,
      status: 'incomplete',
      stop_reason: 'steered',
    })]);
  });

  it('counts current OpenAI and xAI native tool calls in terminal usage', async () => {
    const converter = new OpenAIResponsesStreamConverter();
    const result = await collect(converter.convertStream(events({
      type: 'response.completed',
      sequence_number: 1,
      response: {
        id: 'resp_1', status: 'completed', model: 'gpt-6-astra', created_at: 1,
        output: [
          { type: 'computer_call' },
          { type: 'shell_call' },
          { type: 'apply_patch_call' },
          { type: 'tool_search_call' },
          { type: 'image_generation_call' },
          { type: 'x_search_call' },
          { type: 'code_execution_call' },
        ],
        usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
      },
    })));

    expect(result).toContainEqual(expect.objectContaining({
      type: StreamEventType.RESPONSE_COMPLETE,
      usage: expect.objectContaining({
        native_tool_calls: {
          computer_use: 1,
          hosted_shell: 1,
          apply_patch: 1,
          tool_search: 1,
          image_generation: 1,
          x_search: 1,
          code_execution: 1,
        },
      }),
    }));
  });

  it('emits encrypted compaction output for stateless replay', async () => {
    const converter = new OpenAIResponsesStreamConverter();
    const result = await collect(converter.convertStream(events(
      {
        type: 'response.created', sequence_number: 0,
        response: { id: 'resp_1', model: 'gpt-6-astra', created_at: 1 },
      },
      {
        type: 'response.output_item.done', sequence_number: 1, output_index: 2,
        item: { type: 'compaction', id: 'cmp_1', encrypted_content: 'opaque-state' },
      },
    )));

    expect(result).toContainEqual({
      type: StreamEventType.COMPACTION,
      response_id: 'resp_1',
      item_id: 'cmp_1',
      output_index: 2,
      encrypted_content: 'opaque-state',
      sequence_number: 0,
    });
  });

  it('emits one completed reasoning event with encrypted replay metadata', async () => {
    const converter = new OpenAIResponsesStreamConverter();
    const result = await collect(converter.convertStream(events(
      {
        type: 'response.created', sequence_number: 0,
        response: { id: 'resp_reasoning', model: 'gpt-6-astra', created_at: 1 },
      },
      {
        type: 'response.output_item.added', sequence_number: 1, output_index: 0,
        item: { type: 'reasoning', id: 'reasoning_1', summary: [] },
      },
      {
        type: 'response.reasoning_text.done', sequence_number: 2,
        item_id: 'reasoning_1', output_index: 0, content_index: 0,
        text: 'Completed reasoning',
      },
      {
        type: 'response.output_item.done', sequence_number: 3, output_index: 0,
        item: {
          type: 'reasoning', id: 'reasoning_1', summary: [],
          encrypted_content: 'encrypted-replay-state', effort: 'high',
        },
      },
    )));

    expect(result.filter((event) => event.type === StreamEventType.REASONING_DONE)).toEqual([{
      type: StreamEventType.REASONING_DONE,
      response_id: 'resp_reasoning',
      item_id: 'reasoning_1',
      output_index: 0,
      sequence_number: 0,
      thinking: 'Completed reasoning',
      encrypted_content: 'encrypted-replay-state',
      effort: 'high',
    }]);
  });

  it('throws a code-preserving error when a streamed response fails', async () => {
    const converter = new OpenAIResponsesStreamConverter();
    await expect(collect(converter.convertStream(events({
      type: 'response.failed',
      sequence_number: 1,
      response: {
        id: 'resp_1',
        error: { code: 'misalignment_policy_violation', message: 'stopped' },
      },
    })))).rejects.toMatchObject({
      code: 'misalignment_policy_violation',
      status: 403,
      response_id: 'resp_1',
    });
  });
});
