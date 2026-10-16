import { ContentType, MessageRole, StreamEventType } from '@everworker/oneringai';
import type { ITextProvider, LLMResponse, TextGenerateOptions, StreamEvent } from '@everworker/oneringai';

export interface ScriptedFrame {
  text?: string;
  calls?: Array<{ id: string; name: string; args: Record<string, unknown> | string }>;
  status?: 'completed' | 'incomplete' | 'failed';
  stopReason?: string;
}

/** Deterministic local model simulation; an exhausted script fails explicitly. */
export class ScriptedLoopProvider implements ITextProvider {
  readonly name = 'scripted-loop';
  readonly capabilities = { text: true, images: false, videos: false, audio: false };
  readonly requests: TextGenerateOptions[] = [];
  constructor(private readonly frames: readonly ScriptedFrame[]) {}
  async validateConfig(): Promise<boolean> { return true; }
  async listModels(): Promise<string[]> { return ['gpt-4o-mini']; }
  getModelCapabilities() {
    return { supportsTools: true, supportsVision: false, supportsJSON: true,
      supportsJSONSchema: false, maxTokens: 128000, maxOutputTokens: 4096 };
  }
  async generate(options: TextGenerateOptions): Promise<LLMResponse> {
    const frame = this.frames[this.requests.length];
    if (!frame) throw new Error('Scripted loop provider exhausted');
    this.requests.push({ ...options, input: structuredClone(options.input) });
    return { id: `script-${this.requests.length}`, object: 'response', created_at: 1,
      model: options.model, status: frame.status ?? 'completed', output_text: frame.text ?? '',
      output: [{ type: 'message', role: MessageRole.ASSISTANT, content: [
        ...(frame.text === undefined ? [] : [{ type: ContentType.OUTPUT_TEXT as const, text: frame.text }]),
        ...(frame.calls ?? []).map(call => ({ type: ContentType.TOOL_USE as const, id: call.id,
          name: call.name, arguments: typeof call.args === 'string' ? call.args : JSON.stringify(call.args) })),
      ] }], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      ...(frame.stopReason ? { stop_reason: frame.stopReason } : {}) };
  }
  async *streamGenerate(options: TextGenerateOptions): AsyncIterableIterator<StreamEvent> {
    const response = await this.generate(options);
    let sequence = 0;
    if (response.output_text) yield { type: StreamEventType.OUTPUT_TEXT_DELTA, response_id: response.id,
      item_id: response.id, output_index: 0, content_index: 0, sequence_number: sequence++, delta: response.output_text };
    for (const item of response.output) if (item.type === 'message') for (const block of item.content) {
      if (block.type !== ContentType.TOOL_USE) continue;
      yield { type: StreamEventType.TOOL_CALL_START, response_id: response.id, item_id: response.id,
        tool_call_id: block.id, tool_name: block.name, output_index: 0, sequence_number: sequence++ };
      yield { type: StreamEventType.TOOL_CALL_ARGUMENTS_DONE, response_id: response.id,
        tool_call_id: block.id, tool_name: block.name, arguments: block.arguments };
    }
    yield { type: StreamEventType.RESPONSE_COMPLETE, response_id: response.id,
      status: response.status as 'completed' | 'incomplete' | 'failed', usage: response.usage,
      iterations: 1, ...(response.stop_reason ? { stop_reason: response.stop_reason } : {}) };
  }
}
