/**
 * Anthropic Converter - Converts between our Responses API format and Anthropic Messages API
 *
 * Extends BaseConverter for common patterns:
 * - Input normalization
 * - Tool conversion
 * - Response building
 * - Resource cleanup
 */

import Anthropic from '@anthropic-ai/sdk';
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema.js';
import { BaseConverter } from '../base/BaseConverter.js';
import { TextGenerateOptions } from '../../../domain/interfaces/ITextProvider.js';
import { LLMResponse } from '../../../domain/entities/Response.js';
import { InputItem, MessageRole } from '../../../domain/entities/Message.js';
import { Content, ContentType } from '../../../domain/entities/Content.js';
import { Tool } from '../../../domain/entities/Tool.js';
import { getModelInfo } from '../../../domain/entities/Model.js';
import { transformForAnthropic, ProviderToolFormat } from '../shared/ToolConversionUtils.js';
import { mapAnthropicStatus, ResponseStatus } from '../shared/ResponseBuilder.js';
import { validateThinkingConfig } from '../shared/validateThinkingConfig.js';
import { logger } from '../../observability/Logger.js';

/**
 * Last-resort `max_tokens` default when the model isn't in the registry
 * (or its entry lacks `features.output.tokens`) and the caller didn't pass
 * `max_output_tokens`. Sized for current-generation Anthropic output ceilings;
 * falling through to this value triggers a warn log so operators can audit
 * the misconfigured model.
 */
const ANTHROPIC_UNKNOWN_MODEL_MAX_TOKENS = 64_000;
const ANTHROPIC_ADAPTIVE_THINKING_MODELS = [
  /^claude-(?:opus-5|fable-5|mythos-5)(?:-|$)/,
  /^claude-opus-4-[678](?:-|$)/,
  /^claude-sonnet-(?:5|4-6)(?:-|$)/,
] as const;

function usesAdaptiveThinking(model: string): boolean {
  return ANTHROPIC_ADAPTIVE_THINKING_MODELS.some((pattern) => pattern.test(model));
}

type AnthropicThinkingMode = 'adaptive' | 'enabled' | 'between_tools' | 'disabled';

function supportedThinkingModes(model: string): ReadonlySet<AnthropicThinkingMode> {
  if (/^claude-opus-5-5(?:-|$)/.test(model)) return new Set(['adaptive']);
  if (/^claude-sonnet-5-5(?:-|$)/.test(model)) return new Set(['adaptive', 'between_tools']);
  if (/^claude-(?:fable|mythos)-5(?:-1)?(?:-|$)/.test(model)) return new Set(['adaptive']);
  if (/^claude-(?:opus|sonnet)-5(?:-|$)/.test(model)) return new Set(['adaptive', 'disabled']);
  if (/^claude-opus-4-[78](?:-|$)/.test(model)) return new Set(['adaptive', 'disabled']);
  if (/^claude-mythos-preview(?:-|$)/.test(model)) return new Set(['adaptive', 'enabled']);
  if (/^claude-(?:opus|sonnet)-4-6(?:-|$)/.test(model)) {
    return new Set(['adaptive', 'enabled', 'disabled']);
  }
  return new Set(['enabled', 'disabled']);
}

export class AnthropicConverter extends BaseConverter<Anthropic.MessageCreateParams, Anthropic.Message> {
  readonly providerName = 'anthropic';

  /**
   * Convert our format -> Anthropic Messages API format
   */
  convertRequest(options: TextGenerateOptions): Anthropic.MessageCreateParams {
    const messages = this.convertMessages(
      options.input,
      options.vendorOptions?.compaction !== undefined,
    );
    const tools = [
      ...(this.convertAnthropicTools(options.tools) ?? []),
      ...this.convertNativeTools(options),
    ];

    // Anthropic's Messages API REQUIRES `max_tokens`. When the caller didn't
    // set one, use the model's capability max (from the registry) so the
    // model can emit as much as it physically can. Hardcoding a small
    // fallback (previously 4096) silently truncated long responses. Final
    // fallback for unknown models is `ANTHROPIC_UNKNOWN_MODEL_MAX_TOKENS` —
    // and when we reach it, emit a warn so operators notice the missing
    // registry entry (otherwise an Anthropic 400 would be the only signal).
    // See feedback_no_output_limits.md.
    let max_tokens: number;
    if (options.max_output_tokens !== undefined) {
      max_tokens = options.max_output_tokens;
    } else {
      const modelMax = getModelInfo(options.model)?.features?.output?.tokens;
      if (typeof modelMax === 'number') {
        max_tokens = modelMax;
      } else {
        max_tokens = ANTHROPIC_UNKNOWN_MODEL_MAX_TOKENS;
        logger.warn(
          {
            component: 'AnthropicConverter',
            model: options.model,
            fallback: ANTHROPIC_UNKNOWN_MODEL_MAX_TOKENS,
          },
          'Anthropic model not in registry (or missing features.output.tokens); defaulted max_tokens to library fallback. Register the model via Model.create() to suppress.',
        );
      }
    }

    const params: Anthropic.MessageCreateParams = {
      model: options.model,
      max_tokens,
      messages,
    };
    const vendorOptions = options.vendorOptions ?? {};
    const rawParams = params as unknown as Record<string, unknown>;
    const hasCompactionInput = Array.isArray(options.input) &&
      options.input.some((item) => item.type === 'compaction');
    const onDemandCompaction = vendorOptions.compaction !== undefined;
    const serviceTier = vendorOptions.serviceTier ?? vendorOptions.service_tier;
    if (serviceTier !== undefined) rawParams.service_tier = serviceTier;
    if (vendorOptions.inference_geo !== undefined) {
      rawParams.inference_geo = vendorOptions.inference_geo;
    }
    if (vendorOptions.container !== undefined) rawParams.container = vendorOptions.container;
    if (onDemandCompaction) {
      rawParams.compaction = vendorOptions.compaction === true
        ? { type: 'summarize' }
        : vendorOptions.compaction;
      rawParams.betas = [
        ...new Set([
          ...((rawParams.betas as string[] | undefined) ?? []),
          'compact-2026-09-04',
        ]),
      ];
    }
    const contextManagement = vendorOptions.contextManagement ?? vendorOptions.context_management;
    if (onDemandCompaction && contextManagement !== undefined) {
      throw new Error(
        'Anthropic on-demand compaction cannot be combined with context_management threshold compaction',
      );
    }
    if (contextManagement !== undefined) {
      rawParams.context_management = contextManagement;
      rawParams.betas = [
        ...new Set([
          ...((rawParams.betas as string[] | undefined) ?? []),
          'compact-2026-01-12',
        ]),
      ];
    }
    if (hasCompactionInput) {
      // A signed block can originate from either on-demand or threshold
      // compaction. Sending both protocol betas makes either replayable while
      // the block itself is forwarded unchanged.
      rawParams.betas = [
        ...new Set([
          ...((rawParams.betas as string[] | undefined) ?? []),
          'compact-2026-09-04',
          'compact-2026-01-12',
        ]),
      ];
    }
    // Anthropic's request metadata schema contains only `user_id`. Generic
    // OneRingAI metadata may carry arbitrary host keys, so never forward the
    // full record and let the remote API reject it.
    if (options.metadata?.user_id !== undefined) {
      params.metadata = { user_id: options.metadata.user_id };
    }
    if (vendorOptions.speed !== undefined) {
      rawParams.speed = vendorOptions.speed;
      rawParams.betas = [
        ...new Set([
          ...((rawParams.betas as string[] | undefined) ?? []),
          'fast-mode-2026-02-01',
        ]),
      ];
    }

    // Add system instruction if provided
    if (options.instructions) {
      params.system = options.instructions;
    }

    // Add tools if provided
    if (tools.length > 0) {
      params.tools = tools as Anthropic.MessageCreateParams['tools'];
    }

    if (options.prompt_cache?.mode === 'auto') {
      (params as unknown as Record<string, unknown>).cache_control = {
        type: 'ephemeral',
        ...(options.prompt_cache.ttl === 'extended' ? { ttl: '1h' } : {}),
      };
    }

    const mcpServers = (options.native_tools ?? [])
      .filter((tool) => tool.capability === 'remote_mcp')
      .map((tool) => {
        const resolvedToken = (
          tool.server as typeof tool.server & { resolvedAuthorizationToken?: string }
        ).resolvedAuthorizationToken;
        return {
          type: 'url',
          name: tool.server.name,
          url: tool.server.url,
          ...(resolvedToken ? { authorization_token: resolvedToken } : {}),
          ...(tool.server.allowedTools
            ? { tool_configuration: { allowed_tools: tool.server.allowedTools } }
            : {}),
        };
      });
    if (mcpServers.length > 0) {
      (params as unknown as Record<string, unknown>).mcp_servers = mcpServers;
      rawParams.betas = [
        ...new Set([
          ...((rawParams.betas as string[] | undefined) ?? []),
          'mcp-client-2025-11-20',
        ]),
      ];
    }

    // Some models (e.g. claude-opus-4-7) deprecate the `temperature` parameter entirely.
    // Registry opt-out: features.parameters.temperature === false.
    // Default is supported — unknown / missing registry entries pass temperature through.
    const supportsTemperature =
      getModelInfo(options.model)?.features.parameters?.temperature !== false;

    const requestedThinkingMode = options.thinking?.mode;
    const isOpus55 = /^claude-opus-5-5(?:-|$)/.test(options.model);
    const isSonnet55 = /^claude-sonnet-5-5(?:-|$)/.test(options.model);
    const requiresAdaptiveThinking = isOpus55;
    if (options.thinking) validateThinkingConfig(options.thinking);
    if (requestedThinkingMode) {
      const supportedModes = supportedThinkingModes(options.model);
      if (!supportedModes.has(requestedThinkingMode)) {
        throw new Error(
          `${options.model} does not support Anthropic thinking mode '${requestedThinkingMode}'; ` +
          `use ${[...supportedModes].join(', ')}`,
        );
      }
      if (
        requestedThinkingMode === 'between_tools'
        && (options.thinking?.budgetTokens !== undefined || vendorOptions.thinkingDisplay !== undefined)
      ) {
        throw new Error('Anthropic between_tools thinking does not accept budgetTokens or thinkingDisplay');
      }
    }

    // Add thinking/reasoning support. Opus 5.5 always uses adaptive thinking.
    if (requiresAdaptiveThinking || options.thinking?.enabled || requestedThinkingMode) {
      if (requestedThinkingMode === 'disabled' && !requiresAdaptiveThinking) {
        (params as any).thinking = { type: 'disabled' };
      } else if (requestedThinkingMode === 'between_tools') {
        (params as any).thinking = { type: 'between_tools' };
      } else if (requestedThinkingMode === 'enabled') {
        const budgetTokens = options.thinking?.budgetTokens || 10000;
        if (budgetTokens < 1024 || budgetTokens >= max_tokens) {
          throw new Error(
            `Anthropic thinking budgetTokens must be at least 1024 and less than max_output_tokens (${max_tokens})`,
          );
        }
        (params as any).thinking = { type: 'enabled', budget_tokens: budgetTokens };
        if (supportsTemperature) params.temperature = 1;
      } else if (usesAdaptiveThinking(options.model) || requestedThinkingMode === 'adaptive') {
        (params as any).thinking = {
          type: 'adaptive',
          ...(vendorOptions.thinkingDisplay
            ? { display: vendorOptions.thinkingDisplay }
            : {}),
        };
      } else if (options.thinking?.enabled) {
        const budgetTokens = options.thinking.budgetTokens || 10000;
        if (budgetTokens < 1024 || budgetTokens >= max_tokens) {
          throw new Error(
            `Anthropic thinking budgetTokens must be at least 1024 and less than max_output_tokens (${max_tokens})`,
          );
        }
        (params as any).thinking = {
          type: 'enabled',
          budget_tokens: budgetTokens,
        };
        // Legacy fixed-budget thinking requires temperature=1 on models that accept it.
        if (supportsTemperature) params.temperature = 1;
      }
    } else if (options.temperature !== undefined && supportsTemperature) {
      // Only set temperature if thinking is not enabled and the model accepts it
      params.temperature = options.temperature;
    }

    // Explicit thinking modes also enable the provider-neutral effort field.
    // Callers that want effort without normalized thinking can use
    // vendorOptions.effort directly.
    const requestedEffort = options.thinking?.enabled || requestedThinkingMode
      ? (options.thinking?.effort ?? vendorOptions.effort)
      : vendorOptions.effort;
    if (
      isSonnet55
      && requestedThinkingMode === 'between_tools'
      && (requestedEffort === 'xhigh' || requestedEffort === 'max')
    ) {
      throw new Error(
        'Claude Sonnet 5.5 between_tools thinking supports effort high or below',
      );
    }
    if (
      /^claude-opus-5(?:-|$)/.test(options.model)
      && requestedThinkingMode === 'disabled'
      && (requestedEffort === 'xhigh' || requestedEffort === 'max')
    ) {
      throw new Error(
        'Claude Opus 5 disabled thinking supports effort high or below',
      );
    }
    if (requestedEffort && requestedEffort !== 'none') {
      const effort = requestedEffort === 'minimal' ? 'low' : requestedEffort;
      params.output_config = { ...(params.output_config ?? {}), effort } as Anthropic.OutputConfig;
    } else if (requiresAdaptiveThinking) {
      params.output_config = { ...(params.output_config ?? {}), effort: 'medium' } as Anthropic.OutputConfig;
    }

    if (options.tool_choice && !onDemandCompaction) {
      const forcedTool = options.tool_choice === 'required' || typeof options.tool_choice === 'object';
      if (forcedTool && /^claude-(?:opus|sonnet)-5-5(?:-|$)/.test(options.model)) {
        throw new Error(
          `${options.model} does not support forced Anthropic tool_choice; use 'auto'`,
        );
      }
      const disableParallel = options.parallel_tool_calls === false;
      params.tool_choice = options.tool_choice === 'auto'
        ? { type: 'auto', ...(disableParallel ? { disable_parallel_tool_use: true } : {}) }
        : options.tool_choice === 'required'
          ? { type: 'any', ...(disableParallel ? { disable_parallel_tool_use: true } : {}) }
          : {
              type: 'tool',
              name: options.tool_choice.function.name,
              ...(disableParallel ? { disable_parallel_tool_use: true } : {}),
            };
    }

    if (options.response_format?.type === 'json_schema' && !onDemandCompaction) {
      const jsonSchema = options.response_format.json_schema;
      const schema =
        jsonSchema && typeof jsonSchema === 'object' && 'schema' in jsonSchema
          ? jsonSchema.schema
          : jsonSchema;
      if (schema && typeof schema === 'object') {
        // Raw JSON Schema can contain constraints that Anthropic's grammar
        // compiler does not support (for example minItems > 1, maxItems,
        // minLength, or numeric bounds). Use the official SDK transformer so
        // supported constraints remain structural while unsupported ones move
        // into descriptions as model guidance. The transformer deep-clones the
        // input, preserving the caller's original schema for host validation.
        const anthropicSchema = transformJSONSchema(schema as Record<string, unknown>);
        params.output_config = {
          ...(params.output_config ?? {}),
          format: { type: 'json_schema', schema: anthropicSchema },
        };
      }
    }

    return params;
  }

  /**
   * Convert Anthropic response -> our LLMResponse format
   */
  convertResponse(response: Anthropic.Message): LLMResponse {
    const cacheReadInputTokens = response.usage.cache_read_input_tokens ?? 0;
    const cacheCreationInputTokens = response.usage.cache_creation_input_tokens ?? 0;
    // Anthropic reports mutually exclusive input buckets. Normalize the shared
    // input_tokens field to the total processed input so it has the same
    // meaning as OpenAI/Google and can be priced without discarding cache hits.
    const totalInputTokens =
      response.usage.input_tokens + cacheReadInputTokens + cacheCreationInputTokens;
    const reasoningTokens = (
      response.usage as Anthropic.Usage & {
        output_tokens_details?: { thinking_tokens?: number } | null;
      }
    ).output_tokens_details?.thinking_tokens;
    const built = this.buildResponse({
      rawId: response.id,
      model: response.model,
      status: this.mapProviderStatus(response.stop_reason),
      content: this.convertProviderContent(response.content),
      messageId: response.id,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens: response.usage.cache_read_input_tokens || undefined,
        cacheCreationInputTokens: response.usage.cache_creation_input_tokens || undefined,
        cacheCreationDetails:
          response.usage.cache_creation &&
          (response.usage.cache_creation.ephemeral_5m_input_tokens > 0 ||
            response.usage.cache_creation.ephemeral_1h_input_tokens > 0)
          ? {
              shortTtlInputTokens:
                response.usage.cache_creation.ephemeral_5m_input_tokens,
              extendedTtlInputTokens:
                response.usage.cache_creation.ephemeral_1h_input_tokens,
            }
          : undefined,
        reasoningTokens,
        nativeToolCalls:
          response.usage.server_tool_use &&
          (response.usage.server_tool_use.web_search_requests > 0 ||
            response.usage.server_tool_use.web_fetch_requests > 0)
          ? {
              web_search: response.usage.server_tool_use.web_search_requests ?? 0,
              web_fetch: response.usage.server_tool_use.web_fetch_requests ?? 0,
            }
          : undefined,
        serviceTier: response.usage.service_tier ?? undefined,
        speed: (response.usage as Anthropic.Usage & { speed?: string | null }).speed ?? undefined,
      },
    });

    // Surface stop_reason + stop_details for diagnostics. `stop_details` is
    // populated by Anthropic only for refusals and names the classifier that
    // fired; cast defensively since older SDK typings may omit it.
    if (response.stop_reason) {
      built.stop_reason = response.stop_reason;
    }
    const rawDetails = (response as {
      stop_details?: { type?: string; category?: string | null; explanation?: string | null } | null;
    }).stop_details;
    if (rawDetails) {
      built.stop_details = {
        type: rawDetails.type,
        category: rawDetails.category ?? null,
        explanation: rawDetails.explanation ?? null,
      };
    }
    const nativeToolEvents = this.extractNativeToolEvents(response.content);
    if (nativeToolEvents.length > 0) built.native_tool_events = nativeToolEvents;

    if (response.content.some((block) => (block as { type: string }).type === 'compaction')) {
      const orderedOutput: LLMResponse['output'] = [];
      let messageContent: Content[] = [];
      let messageSegment = 0;
      const flushMessage = (): void => {
        if (messageContent.length === 0) return;
        orderedOutput.push({
          type: 'message',
          id: messageSegment === 0 ? response.id : `${response.id}_${messageSegment}`,
          role: MessageRole.ASSISTANT,
          content: messageContent,
        });
        messageContent = [];
        messageSegment++;
      };

      for (const [index, block] of response.content.entries()) {
        if ((block as { type: string }).type !== 'compaction') {
          messageContent.push(...this.convertProviderContent([block]));
          continue;
        }
        flushMessage();
        const compaction = block as unknown as {
          content?: string | null;
          encrypted_content?: string | null;
          signature?: string | null;
          tool_changes?: unknown;
        };
        orderedOutput.push({
          type: 'compaction',
          id: `${response.id}_compaction_${index}`,
          encrypted_content: compaction.encrypted_content ?? '',
          content: compaction.content ?? null,
          signature: compaction.signature ?? null,
          ...(compaction.tool_changes !== undefined
            ? { providerMetadata: { tool_changes: compaction.tool_changes } }
            : {}),
        });
      }
      flushMessage();
      built.output = orderedOutput;
    }

    return built;
  }

  // ==========================================================================
  // BaseConverter Abstract Method Implementations
  // ==========================================================================

  /**
   * Transform standardized tool to Anthropic format
   */
  protected transformTool(tool: ProviderToolFormat): Anthropic.Tool {
    return {
      ...transformForAnthropic(tool),
      input_schema: {
        type: 'object',
        ...tool.parameters,
      } as Anthropic.Tool.InputSchema,
    };
  }

  /**
   * Convert Anthropic content blocks to our Content[]
   */
  protected convertProviderContent(blocks: unknown[]): Content[] {
    const content: Content[] = [];

    for (const block of blocks as Anthropic.ContentBlock[]) {
      if (block.type === 'text') {
        const text = this.createText(block.text);
        if ('citations' in block && Array.isArray(block.citations)) {
          (text as Content & { annotations?: unknown[] }).annotations = block.citations;
        }
        content.push(text);
      } else if (block.type === 'tool_use') {
        content.push(this.createToolUse(block.id, block.name, block.input as Record<string, unknown>));
      } else if (block.type === 'thinking') {
        // Anthropic thinking block - must persist in history for round-tripping
        const thinkingBlock = block as { type: 'thinking'; thinking: string; signature: string };
        content.push({
          type: ContentType.THINKING,
          thinking: thinkingBlock.thinking || '',
          signature: thinkingBlock.signature,
          persistInHistory: true,
        });
      } else if ((block as { type: string }).type === 'compaction') {
        // convertResponse lifts compaction blocks into top-level CompactionItem
        // output. Do not also retain a duplicate provider-state copy in the
        // assistant message.
        continue;
      } else {
        // Server tool calls/results (including tool search references) are
        // provider-owned continuation state. Anthropic requires clients to
        // send these blocks back unchanged alongside the eventual local tool
        // result, so keep the complete block in the assistant message.
        content.push({
          type: ContentType.PROVIDER_STATE,
          provider: 'anthropic',
          data: { ...(block as unknown as Record<string, unknown>) },
        });
      }
    }

    return content;
  }

  /**
   * Map Anthropic stop_reason to ResponseStatus
   */
  protected mapProviderStatus(status: unknown): ResponseStatus {
    return mapAnthropicStatus(status as string | null);
  }

  // ==========================================================================
  // Anthropic-Specific Conversion Methods
  // ==========================================================================

  /**
   * Convert our InputItem[] -> Anthropic messages
   */
  private convertMessages(
    input: string | InputItem[],
    preserveTrailingAssistant = false,
  ): Anthropic.MessageParam[] {
    if (typeof input === 'string') {
      return [{ role: 'user', content: input }];
    }

    const messages: Anthropic.MessageParam[] = [];

    // A compaction block replaces everything it summarizes. Keep the newest
    // signed block and any exact turns that follow it.
    let lastCompactionIndex = -1;
    for (let index = input.length - 1; index >= 0; index--) {
      if (input[index]!.type === 'compaction') {
        lastCompactionIndex = index;
        break;
      }
    }
    const replayInput = lastCompactionIndex >= 0 ? input.slice(lastCompactionIndex) : input;

    for (const item of replayInput) {
      if (item.type === 'message') {
        // Map roles: 'developer' -> 'user' (Anthropic doesn't have developer role)
        const role = this.mapRole(item.role);

        // Convert content
        const content = this.convertContent(item.content);

        // Skip messages with empty content (Anthropic rejects these)
        if (!content || (Array.isArray(content) && content.length === 0) || content === '') {
          continue;
        }

        messages.push({
          role: role as 'user' | 'assistant',
          content,
        });
      } else if (item.type === 'compaction') {
        messages.push({
          role: 'assistant',
          content: [{
            type: 'compaction',
            content: item.content ?? null,
            encrypted_content: item.encrypted_content || null,
            signature: item.signature ?? null,
            ...(item.providerMetadata?.tool_changes !== undefined
              ? { tool_changes: item.providerMetadata.tool_changes }
              : {}),
          }] as any,
        });
      }
    }

    // Safety net: Anthropic requires the conversation to end with a user message.
    // Some models (e.g., claude-opus-4-6) reject assistant prefill entirely.
    // If the last message is assistant (can happen after compaction or context bugs),
    // trim trailing assistant messages to prevent API errors.
    const isCompactionMessage = (message: Anthropic.MessageParam): boolean =>
      Array.isArray(message.content) &&
      message.content.some((block) => (block as { type?: string }).type === 'compaction');
    while (
      !preserveTrailingAssistant &&
      messages.length > 0 &&
      messages[messages.length - 1]!.role === 'assistant' &&
      !isCompactionMessage(messages[messages.length - 1]!)
    ) {
      messages.pop();
    }

    // Anthropic requires an active user turn after replay state. Preserve a
    // trailing signed compaction block and add the minimal continuation turn.
    if (
      messages.length === 0 ||
      (!preserveTrailingAssistant && messages[messages.length - 1]!.role === 'assistant')
    ) {
      messages.push({ role: 'user', content: 'Continue.' });
    }

    return messages;
  }

  /**
   * Convert our Content[] -> Anthropic content blocks
   */
  private convertContent(content: Content[]): Anthropic.MessageParam['content'] {
    const blocks: any[] = [];

    for (const c of content) {
      switch (c.type) {
        case ContentType.INPUT_TEXT:
        case ContentType.OUTPUT_TEXT: {
          // Anthropic rejects empty text content blocks
          const textContent = (c as { text: string }).text;
          if (textContent && textContent.trim()) {
            blocks.push({
              type: 'text',
              text: textContent,
            });
          }
          break;
        }

        case ContentType.INPUT_IMAGE_URL: {
          const imgContent = c as { image_url: { url: string } };
          const block = this.convertImageToAnthropicBlock(imgContent.image_url.url);
          if (block) {
            blocks.push(block);
          }
          break;
        }

        case ContentType.TOOL_RESULT: {
          const resultContent = c as {
            tool_use_id: string;
            content: string | unknown;
            error?: string;
            __images?: Array<{ base64: string; mediaType: string }>;
          };
          blocks.push(this.convertToolResultToAnthropicBlock(resultContent));
          break;
        }

        case ContentType.TOOL_USE: {
          const toolContent = c as { id: string; name: string; arguments: string };
          const parsedInput = this.parseToolArguments(toolContent.name, toolContent.arguments);
          blocks.push({
            type: 'tool_use',
            id: toolContent.id,
            name: toolContent.name,
            input: parsedInput as Record<string, unknown>,
          });
          break;
        }

        case ContentType.THINKING: {
          // Round-trip thinking blocks back to Anthropic format.
          // Only include blocks that have a valid signature — Anthropic requires it.
          // Streaming-path thinking blocks lack signatures and cannot be round-tripped;
          // non-streaming responses (via convertResponse) always carry signatures.
          const thinkingContent = c as { thinking: string; signature?: string };
          if (thinkingContent.signature) {
            blocks.push({
              type: 'thinking',
              thinking: thinkingContent.thinking,
              signature: thinkingContent.signature,
            } as any);
          }
          break;
        }

        case ContentType.PROVIDER_STATE: {
          if (c.provider === 'anthropic') blocks.push({ ...c.data });
          break;
        }
      }
    }

    // If only one text block, return as string
    if (blocks.length === 1 && blocks[0]?.type === 'text') {
      return String(blocks[0].text ?? '');
    }

    return blocks as Anthropic.MessageParam['content'];
  }

  /**
   * Convert image URL to Anthropic image block
   */
  private convertImageToAnthropicBlock(url: string): Anthropic.ImageBlockParam | null {
    const parsed = this.parseDataUri(url);

    if (parsed) {
      // Base64 data URI
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: parsed.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: parsed.data,
        },
      };
    } else {
      // URL (Claude 3.5+ supports this)
      return {
        type: 'image',
        source: {
          type: 'url',
          url,
        },
      };
    }
  }

  /**
   * Convert tool result to Anthropic block
   * Anthropic requires non-empty content when is_error is true
   * Supports __images convention: tool results with __images get multimodal content
   */
  private convertToolResultToAnthropicBlock(resultContent: {
    tool_use_id: string;
    content: string | unknown;
    error?: string;
    __images?: Array<{ base64: string; mediaType: string }>;
  }): Anthropic.ToolResultBlockParam {
    const isError = !!resultContent.error;
    let toolResultContent: string;

    if (typeof resultContent.content === 'string') {
      // For error cases with empty content, use the error message
      toolResultContent = resultContent.content || (isError ? resultContent.error! : '');
    } else {
      toolResultContent = JSON.stringify(resultContent.content);
    }

    // Anthropic API rejects empty content when is_error is true
    if (isError && !toolResultContent) {
      toolResultContent = resultContent.error || 'Tool execution failed';
    }

    // Read images from Content object first (set by addToolResults),
    // fall back to JSON extraction for backward compat
    const images = resultContent.__images?.length
      ? resultContent.__images
      : this.extractImages(toolResultContent);

    if (images) {
      // Strip __images and base64 from text to save tokens (needed for JSON fallback path)
      const textContent = resultContent.__images?.length
        ? toolResultContent  // Already stripped at context layer
        : this.stripImagesFromContent(toolResultContent);
      const contentBlocks: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [];

      if (textContent.trim()) {
        contentBlocks.push({ type: 'text', text: textContent });
      }

      for (const img of images) {
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: (img.mediaType || 'image/png') as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
            data: img.base64,
          },
        });
      }

      return {
        type: 'tool_result',
        tool_use_id: resultContent.tool_use_id,
        content: contentBlocks.length > 0 ? contentBlocks : textContent,
        is_error: isError,
      };
    }

    return {
      type: 'tool_result',
      tool_use_id: resultContent.tool_use_id,
      content: toolResultContent,
      is_error: isError,
    };
  }

  /**
   * Extract __images from a JSON-stringified tool result content.
   * Returns null if no images found.
   */
  private extractImages(content: string): Array<{ base64: string; mediaType: string }> | null {
    try {
      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.__images) && parsed.__images.length > 0) {
        return parsed.__images;
      }
    } catch {
      // Not JSON or no __images
    }
    return null;
  }

  /**
   * Strip __images and base64 fields from JSON content to reduce token usage in text.
   */
  private stripImagesFromContent(content: string): string {
    try {
      const parsed = JSON.parse(content);
      const { __images: _, base64: __, ...rest } = parsed;
      return JSON.stringify(rest);
    } catch {
      return content;
    }
  }

  /**
   * Convert our Tool[] -> Anthropic tools
   * Uses shared conversion utilities (DRY)
   */
  private convertAnthropicTools(tools?: Tool[]): Anthropic.Tool[] | undefined {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    return tools
      .filter((tool) => tool.type === 'function')
      .map((tool) => {
        const converted = this.transformTool({
          name: tool.function.name,
          description: tool.function.description ?? '',
          parameters: tool.function.parameters ?? { type: 'object', properties: {} },
        }) as Anthropic.Tool & Record<string, unknown>;
        if (tool.function.strict !== undefined) converted.strict = tool.function.strict;
        if (tool.deferLoading !== undefined) converted.defer_loading = tool.deferLoading;
        if (tool.allowedCallers?.length) {
          converted.allowed_callers = tool.allowedCallers.map((caller) =>
            caller === 'programmatic' ? 'code_execution_20260521' : 'direct',
          );
        }
        return converted as Anthropic.Tool;
      });
  }

  private convertNativeTools(options: TextGenerateOptions): unknown[] {
    return (options.native_tools ?? []).map((tool) => {
      const extra = tool.options ?? {};
      switch (tool.capability) {
        case 'web_search':
          return { ...extra, type: 'web_search_20260318', name: 'web_search' };
        case 'web_fetch':
          return { ...extra, type: 'web_fetch_20260318', name: 'web_fetch' };
        case 'code_execution':
          return { ...extra, type: 'code_execution_20260521', name: 'code_execution' };
        case 'tool_search': {
          const { algorithm, variant, ...toolSearchOptions } = extra;
          const selected = algorithm ?? variant;
          const searchVariant = selected === 'bm25' ? 'bm25' : 'regex';
          return {
            ...toolSearchOptions,
            type: `tool_search_tool_${searchVariant}_20251119`,
            name: `tool_search_tool_${searchVariant}`,
          };
        }
        case 'remote_mcp':
          return {
            ...extra,
            type: 'mcp_toolset',
            mcp_server_name: tool.server.name,
            ...(tool.server.allowedTools
              ? {
                  default_config: { enabled: false },
                  configs: Object.fromEntries(
                    tool.server.allowedTools.map((name) => [name, { enabled: true }]),
                  ),
                }
              : {}),
          };
        default:
          return extra;
      }
    });
  }

  private extractNativeToolEvents(
    blocks: Anthropic.ContentBlock[],
  ): NonNullable<LLMResponse['native_tool_events']> {
    const events: NonNullable<LLMResponse['native_tool_events']> = [];
    for (const block of blocks as unknown as Array<Record<string, unknown>>) {
      const type = String(block.type ?? '');
      const capability = type.includes('web_search')
        ? 'web_search'
        : type.includes('web_fetch')
          ? 'web_fetch'
          : type.includes('code_execution')
            ? 'code_execution'
            : type.includes('tool_search') || type === 'server_tool_use' && String(block.name).startsWith('tool_search_tool_')
              ? 'tool_search'
            : type.includes('mcp_') || type === 'server_tool_use' && block.name === 'mcp'
              ? 'remote_mcp'
              : type === 'server_tool_use' && typeof block.name === 'string'
                ? block.name
                : undefined;
      if (!capability) continue;
      const rawError = block.error ?? (block.is_error ? block.content : undefined);
      events.push({
        capability,
        ...(typeof block.id === 'string'
          ? { id: block.id }
          : typeof block.tool_use_id === 'string'
            ? { id: block.tool_use_id }
            : {}),
        status: rawError ? 'failed' : type.endsWith('_result') ? 'completed' : 'in_progress',
        ...(rawError
          ? {
              error: {
                message:
                  typeof rawError === 'object' && rawError && 'message' in rawError
                    ? String((rawError as { message?: unknown }).message)
                    : String(rawError),
                details: rawError,
              },
            }
          : {}),
      });
    }
    return events;
  }
}
