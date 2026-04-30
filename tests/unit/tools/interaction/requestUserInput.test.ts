/**
 * Unit tests for createRequestUserInputTool.
 *
 * Verifies the tool factory wraps an app-supplied delivery into a SuspendSignal
 * with correct correlation, metadata flow, error propagation, and validation.
 */

import { describe, it, expect, vi } from 'vitest';
import { createRequestUserInputTool } from '@/tools/interaction/index.js';
import type {
  IUserInteractionDelivery,
  UserInteractionDeliveryResult,
} from '@/tools/interaction/index.js';
import { SuspendSignal } from '@/core/SuspendSignal.js';

function makeDelivery(
  result: UserInteractionDeliveryResult,
  id = 'test-channel',
): IUserInteractionDelivery {
  return {
    id,
    send: vi.fn().mockResolvedValue(result),
  };
}

describe('createRequestUserInputTool', () => {
  it('produces a ToolFunction with the default name and required parameters', () => {
    const tool = createRequestUserInputTool(
      makeDelivery({ correlationId: 'x', channel: 'test' }),
    );
    expect(tool.definition.function.name).toBe('request_user_input');
    expect(tool.definition.function.parameters?.required).toEqual(['prompt']);
    expect(tool.permission?.scope).toBe('always');
  });

  it('honors toolName / description / resumeAs / ttl options', async () => {
    const delivery = makeDelivery({ correlationId: 'cid:1', channel: 'test' });
    const tool = createRequestUserInputTool(delivery, {
      toolName: 'ask_human',
      description: 'custom desc',
      resumeAs: 'user_message',
      ttl: 3600_000,
    });
    expect(tool.definition.function.name).toBe('ask_human');
    expect(tool.definition.function.description).toBe('custom desc');

    const signal = (await tool.execute({ prompt: 'hi' })) as SuspendSignal;
    expect(SuspendSignal.is(signal)).toBe(true);
    expect(signal.resumeAs).toBe('user_message');
    expect(signal.ttl).toBe(3600_000);
  });

  it('default resumeAs is "tool_result"', async () => {
    const tool = createRequestUserInputTool(
      makeDelivery({ correlationId: 'cid', channel: 'c' }),
    );
    const signal = (await tool.execute({ prompt: 'hi' })) as SuspendSignal;
    expect(signal.resumeAs).toBe('tool_result');
  });

  it('forwards prompt + context + schema + metadata to delivery.send and includes ToolContext fields', async () => {
    const delivery = makeDelivery({ correlationId: 'cid', channel: 'c' });
    const tool = createRequestUserInputTool(delivery);

    await tool.execute(
      {
        prompt: 'Approve?',
        context: 'PR review for #42',
        schema: { type: 'object', properties: { approved: { type: 'boolean' } } },
        metadata: { priority: 'high' },
      },
      { agentId: 'agent-1', sessionId: 'sess-1', userId: 'user-1' },
    );

    expect(delivery.send).toHaveBeenCalledTimes(1);
    expect(delivery.send).toHaveBeenCalledWith(
      {
        prompt: 'Approve?',
        context: 'PR review for #42',
        schema: { type: 'object', properties: { approved: { type: 'boolean' } } },
        metadata: { priority: 'high' },
      },
      { agentId: 'agent-1', sessionId: 'sess-1', userId: 'user-1' },
    );
  });

  it('returns a SuspendSignal carrying the correlationId from the delivery', async () => {
    const tool = createRequestUserInputTool(
      makeDelivery({ correlationId: 'slack:C1/123.456', channel: 'slack' }),
    );
    const signal = (await tool.execute({ prompt: 'hi' })) as SuspendSignal;
    expect(SuspendSignal.is(signal)).toBe(true);
    expect(signal.correlationId).toBe('slack:C1/123.456');
  });

  it('display result (signal.result) includes channel + correlationId + suspended marker', async () => {
    const tool = createRequestUserInputTool(
      makeDelivery({
        correlationId: 'cid-1',
        channel: 'slack',
        description: 'Slack DM to @alice',
      }),
    );
    const signal = (await tool.execute({ prompt: 'hi' })) as SuspendSignal;
    const display = signal.result as {
      channel: string;
      correlationId: string;
      message: string;
      suspended: true;
    };
    expect(display.channel).toBe('slack');
    expect(display.correlationId).toBe('cid-1');
    expect(display.message).toBe('Slack DM to @alice');
    expect(display.suspended).toBe(true);
  });

  it('falls back to a generic message when delivery omits description', async () => {
    const tool = createRequestUserInputTool(
      makeDelivery({ correlationId: 'cid-2', channel: 'email' }),
    );
    const signal = (await tool.execute({ prompt: 'hi' })) as SuspendSignal;
    const display = signal.result as { message: string };
    expect(display.message).toContain('email');
    expect(display.message).toContain('cid-2');
  });

  it('merges delivery.metadata + args.metadata + channel into SuspendSignal.metadata, args last-wins', async () => {
    const tool = createRequestUserInputTool(
      makeDelivery({
        correlationId: 'cid',
        channel: 'slack',
        metadata: { ts: '123.456', shared: 'from-delivery' },
      }),
    );
    const signal = (await tool.execute({
      prompt: 'hi',
      metadata: { priority: 'high', shared: 'from-args' },
    })) as SuspendSignal;
    expect(signal.metadata).toEqual({
      channel: 'slack',
      ts: '123.456',
      shared: 'from-args',
      priority: 'high',
    });
  });

  it('throws when prompt is missing', async () => {
    const tool = createRequestUserInputTool(
      makeDelivery({ correlationId: 'cid', channel: 'c' }),
    );
    await expect(tool.execute({} as never)).rejects.toThrow(/prompt.*required/i);
  });

  it('throws when prompt is empty string or whitespace', async () => {
    const tool = createRequestUserInputTool(
      makeDelivery({ correlationId: 'cid', channel: 'c' }),
    );
    await expect(tool.execute({ prompt: '' })).rejects.toThrow(/prompt.*required/i);
    await expect(tool.execute({ prompt: '   ' })).rejects.toThrow(/prompt.*required/i);
  });

  it('propagates errors thrown by delivery.send unchanged', async () => {
    const delivery: IUserInteractionDelivery = {
      id: 'broken',
      send: vi.fn().mockRejectedValue(new Error('slack 500')),
    };
    const tool = createRequestUserInputTool(delivery);
    await expect(tool.execute({ prompt: 'hi' })).rejects.toThrow('slack 500');
  });

  it('throws when delivery returns no correlationId', async () => {
    const delivery: IUserInteractionDelivery = {
      id: 'broken',
      send: vi.fn().mockResolvedValue({ correlationId: '', channel: 'x' }),
    };
    const tool = createRequestUserInputTool(delivery);
    await expect(tool.execute({ prompt: 'hi' })).rejects.toThrow(/correlationId/);
  });

  it('describeCall returns a short prompt summary', () => {
    const tool = createRequestUserInputTool(
      makeDelivery({ correlationId: 'cid', channel: 'c' }),
    );
    expect(tool.describeCall?.({ prompt: 'short' })).toBe('short');
    const long = 'x'.repeat(200);
    const desc = tool.describeCall?.({ prompt: long }) ?? '';
    expect(desc.length).toBeLessThanOrEqual(80);
    expect(desc.endsWith('...')).toBe(true);
  });

  it('describeCall handles missing prompt gracefully', () => {
    const tool = createRequestUserInputTool(
      makeDelivery({ correlationId: 'cid', channel: 'c' }),
    );
    expect(tool.describeCall?.({} as never)).toBe('asking user');
  });
});
