import type {
  ITextProvider, LLMResponse, TextGenerateOptions, StreamEvent, OutputItem, TokenUsage, Content,
} from '../../src/index.js';
import { ContentType, MessageRole } from '../../src/index.js';
import { canonicalJSON } from './reporter.js';

export interface ReplayCall { id: string; name: string; args: Record<string, unknown> }
export interface ReplayFrame {
  prompt?: string;
  text?: string;
  calls?: ReplayCall[];
  evidence?: Array<ReplayCall & { result: unknown }>;
  usage?: Partial<TokenUsage>;
}

/** Strict scripted simulation, not a model or an unrestricted transcript replay. */
export class ReplayProvider implements ITextProvider {
  readonly name = 'baseline-replay';
  readonly capabilities = { text: true, images: false, videos: false, audio: false };
  private cursor = 0;

  constructor(private readonly frames: readonly ReplayFrame[]) {}

  async generate(options: TextGenerateOptions): Promise<LLMResponse> {
    const frame = this.frames[this.cursor];
    if (!frame) throw new Error('Replay exhausted: no recorded branch matches');
    const content: Content[] = typeof options.input === 'string'
      ? [{ type: ContentType.INPUT_TEXT, text: options.input }]
      : options.input.flatMap(item => item.type === 'message' ? item.content : []);
    if (frame.prompt) {
      const latestText = content.filter(item => item.type === 'input_text').at(-1);
      if (!latestText || latestText.type !== ContentType.INPUT_TEXT || latestText.text !== frame.prompt) throw new Error('Replay prompt mismatch');
    }
    for (const expected of frame.evidence ?? []) {
      const call = content.find(item => item.type === 'tool_use' && item.id === expected.id);
      const result = content.find(item => item.type === 'tool_result' && item.tool_use_id === expected.id);
      if (!call || call.type !== 'tool_use' || call.name !== expected.name ||
          canonicalJSON(JSON.parse(call.arguments)) !== canonicalJSON(expected.args) ||
          !result || result.type !== 'tool_result' || result.error ||
          canonicalJSON(JSON.parse(result.content)) !== canonicalJSON(expected.result)) {
        throw new Error('Replay evidence mismatch: changed arguments/results require a modeled branch');
      }
    }
    for (const call of frame.calls ?? []) {
      if (!options.tools?.some(tool => tool.type === 'function' && tool.function.name === call.name)) {
        throw new Error('Replay requested an unavailable tool');
      }
    }
    this.cursor++;
    const output: OutputItem[] = [{ type: 'message', role: MessageRole.ASSISTANT, content: [
      ...(frame.text === undefined ? [] : [{ type: ContentType.OUTPUT_TEXT as const, text: frame.text }]),
      ...(frame.calls ?? []).map(call => ({
        type: ContentType.TOOL_USE as const, id: call.id, name: call.name, arguments: JSON.stringify(call.args),
      })),
    ] }];
    return {
      id: `baseline-response-${this.cursor}`, object: 'response', created_at: 1,
      model: options.model, status: 'completed', output, output_text: frame.text ?? '',
      usage: (frame.usage ?? { input_tokens: 100, output_tokens: 10, total_tokens: 110 }) as TokenUsage,
    };
  }

  // eslint-disable-next-line require-yield -- This fixture intentionally rejects streaming.
  async *streamGenerate(_options: TextGenerateOptions): AsyncIterableIterator<StreamEvent> {
    throw new Error('Baseline replay covers non-streaming managed execution only');
  }
  getModelCapabilities() {
    return { supportsTools: true, supportsVision: false, supportsJSON: true, supportsJSONSchema: false, maxTokens: 128000, maxOutputTokens: 4096 };
  }
  async listModels(): Promise<string[]> { return ['baseline-replay']; }
  async validateConfig(): Promise<boolean> { return true; }
}
