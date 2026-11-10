import { InvalidConfigError } from '../../../domain/errors/AIErrors.js';
import type * as ResponsesAPI from 'openai/resources/responses/responses.js';

export const CHATGPT_PLAN_NAMESPACE = 'oneringai';
export const CHATGPT_PLAN_BASE_URL = 'https://api.openai.com/v1';
const unsupported = ['background', 'conversation', 'max_output_tokens', 'max_tool_calls', 'metadata',
  'moderation', 'multi_agent', 'prompt', 'prompt_cache_retention', 'safety_identifier', 'temperature',
  'top_logprobs', 'top_p', 'truncation', 'user', 'previous_response_id'];

/** The plan route is an explicit, narrower contract; never silently discard caller controls. */
export function chatGPTPlanRequest(params: Record<string, unknown>): Record<string, unknown> {
  for (const key of unsupported) {
    if (params[key] !== undefined) throw new InvalidConfigError(`ChatGPT plan access does not support ${key}`);
  }
  if (params.store !== undefined && params.store !== false) throw new InvalidConfigError('ChatGPT plan requests require store: false');
  const input = typeof params.input === 'string'
    ? [{ type: 'message', role: 'user', content: params.input }]
    : structuredClone(params.input);
  if (!Array.isArray(input)) throw new InvalidConfigError('ChatGPT plan requests require an input array');
  for (const item of input) {
    if (item.role === 'system') throw new InvalidConfigError('Use developer messages or instructions with ChatGPT plan access');
    if (item.type === 'function_call' || item.type === 'custom_tool_call') item.namespace = CHATGPT_PLAN_NAMESPACE;
    if (Array.isArray(item.content) && item.content.some((c: Record<string, unknown>) =>
      ['input_audio', 'input_video'].includes(String(c.type)) || (c.type === 'input_file' && c.file_id))) {
      throw new InvalidConfigError('ChatGPT plan access requires inline text/image/file inputs; audio, video and uploaded file IDs are unsupported');
    }
  }
  const functions: unknown[] = [];
  const native: unknown[] = [];
  for (const tool of (params.tools as Array<Record<string, unknown>> | undefined) ?? []) {
    if (tool.type === 'function' || tool.type === 'custom') {
      if (tool.defer_loading || tool.allowed_callers || tool.async) {
        throw new InvalidConfigError('ChatGPT plan access does not support deferred, programmatic or async tool declarations');
      }
      functions.push(tool);
    } else if (tool.type === 'web_search') native.push(tool);
    else throw new InvalidConfigError(`ChatGPT plan access does not support hosted tool ${String(tool.type)}`);
  }
  return { ...params, input, store: false, stream: true,
    ...(params.tools ? { tools: [...(functions.length ? [{ type: 'namespace', name: CHATGPT_PLAN_NAMESPACE,
      description: 'Application tools executed by the host.', tools: functions }] : []), ...native] } : {}),
    include: [...new Set([...(params.include as string[] | undefined ?? []), 'reasoning.encrypted_content'])] };
}

/** Preserve leaf tool names in the shared ToolManager; reject foreign namespaces. */
export function assertChatGPTPlanTool(item: { type: string; namespace?: string }): void {
  if ((item.type === 'function_call' || item.type === 'custom_tool_call') && item.namespace !== CHATGPT_PLAN_NAMESPACE) {
    throw new InvalidConfigError('ChatGPT plan response used an unexpected tool namespace');
  }
}

/** Read through termination, including errors after deltas. Never treat a truncated stream as success. */
export async function* checkedChatGPTPlanStream(stream: AsyncIterable<ResponsesAPI.ResponseStreamEvent>): AsyncGenerator<ResponsesAPI.ResponseStreamEvent> {
  let terminal = false;
  for await (const event of stream) {
    if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') assertChatGPTPlanTool(event.item);
    if (event.type === 'response.completed' || event.type === 'response.incomplete' || event.type === 'response.failed') {
      terminal = true;
      for (const item of event.response.output ?? []) assertChatGPTPlanTool(item);
    }
    yield event;
  }
  if (!terminal) throw new InvalidConfigError('ChatGPT plan response stream ended without a terminal response event');
}
