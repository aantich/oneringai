/**
 * Anthropic Stream Converter - Converts Anthropic SSE events to our unified StreamEvent format
 *
 * Extends BaseStreamConverter for common patterns:
 * - State management (response ID, sequence numbers)
 * - Tool call buffering
 * - Usage tracking
 * - Resource cleanup
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  StreamEvent,
  StreamEventType,
  ProviderStopDetails,
} from '../../../domain/entities/StreamEvent.js';
import { BaseStreamConverter } from '../base/BaseStreamConverter.js';
import { mapAnthropicStatus } from '../shared/ResponseBuilder.js';

/**
 * Block info tracked during streaming
 */
interface ContentBlockInfo {
  type: string;
  id?: string;
  name?: string;
  signature?: string;
  content?: string | null;
  encryptedContent?: string | null;
  toolChanges?: unknown;
  rawBlock?: Record<string, unknown>;
  jsonChunks?: string[];
}

/**
 * Converts Anthropic streaming events to our unified StreamEvent format
 */
export class AnthropicStreamConverter extends BaseStreamConverter<Anthropic.MessageStreamEvent> {
  readonly providerName = 'anthropic';

  /** Map of content block index to block info */
  private contentBlockIndex: Map<number, ContentBlockInfo> = new Map();

  /** Captured stop_reason from message_delta event */
  private stopReason: string | null = null;

  /**
   * Captured stop_details from message_delta event. Anthropic populates this
   * only for refusals (`{ type: 'refusal', category, explanation }`) — the
   * `category` names which safety classifier fired. Kept for diagnostics.
   */
  private stopDetails: ProviderStopDetails | undefined = undefined;

  /**
   * Convert a single Anthropic event to our StreamEvent(s)
   */
  protected convertEvent(event: Anthropic.MessageStreamEvent): StreamEvent[] {
    const eventType = event.type;

    switch (eventType) {
      case 'message_start':
        return this.handleMessageStart(event as Anthropic.MessageStartEvent);

      case 'content_block_start':
        return this.handleContentBlockStart(event as Anthropic.ContentBlockStartEvent);

      case 'content_block_delta':
        return this.handleContentBlockDelta(event as Anthropic.ContentBlockDeltaEvent);

      case 'content_block_stop':
        return this.handleContentBlockStop(event as Anthropic.ContentBlockStopEvent);

      case 'message_delta':
        return this.handleMessageDelta(event as Anthropic.MessageDeltaEvent);

      case 'message_stop':
        return this.handleMessageStop();

      default:
        // Handle ping and other event types
        return [];
    }
  }

  /**
   * Clear all internal state
   */
  override clear(): void {
    super.clear();
    this.contentBlockIndex.clear();
    this.stopReason = null;
    this.stopDetails = undefined;
  }

  // ==========================================================================
  // Anthropic-Specific Event Handlers
  // ==========================================================================

  /**
   * Handle message_start event
   */
  private handleMessageStart(event: Anthropic.MessageStartEvent): StreamEvent[] {
    this.responseId = event.message.id;

    // Capture input_tokens from message_start (only place it's available)
    if (event.message.usage) {
      this.updateUsage(
        event.message.usage.input_tokens +
          (event.message.usage.cache_read_input_tokens ?? 0) +
          (event.message.usage.cache_creation_input_tokens ?? 0),
        undefined,
      );
      this.updateDetailedUsage(this.mapDetailedUsage(event.message.usage));
    }

    return [this.emitResponseCreated(this.responseId)];
  }

  /**
   * Handle content_block_start event
   */
  private handleContentBlockStart(event: Anthropic.ContentBlockStartEvent): StreamEvent[] {
    const index = event.index;
    const block = event.content_block as unknown as {
      type: string;
      id?: string;
      name?: string;
      content?: string | null;
      encrypted_content?: string | null;
      signature?: string | null;
      tool_changes?: unknown;
    };

    // Track block type
    if (block.type === 'thinking') {
      this.contentBlockIndex.set(index, { type: 'thinking' });
      return []; // No event needed, thinking will come in deltas
    } else if (block.type === 'text') {
      this.contentBlockIndex.set(index, { type: 'text' });
      return []; // No event needed, text will come in deltas
    } else if (block.type === 'tool_use') {
      const id = block.id ?? '';
      const name = block.name ?? '';
      this.contentBlockIndex.set(index, {
        type: 'tool_use',
        id,
        name,
      });

      return [this.emitToolCallStart(id, name, `tool_${this.responseId}_${index}`, {
        outputIndex: index,
      })];
    } else if (block.type === 'compaction') {
      this.contentBlockIndex.set(index, {
        type: 'compaction',
        content: block.content,
        encryptedContent: block.encrypted_content,
        signature: block.signature ?? undefined,
        toolChanges: block.tool_changes,
      });
      return [];
    }

    // Preserve Anthropic-owned server tool blocks for exact replay. The
    // server_tool_use input arrives as input_json_delta chunks; result blocks
    // are normally complete in content_block_start.
    this.contentBlockIndex.set(index, {
      type: 'provider_state',
      rawBlock: { ...block },
      jsonChunks: [],
    });

    return [];
  }

  /**
   * Handle content_block_delta event
   */
  private handleContentBlockDelta(event: Anthropic.ContentBlockDeltaEvent): StreamEvent[] {
    const index = event.index;
    const delta = event.delta;
    const blockInfo = this.contentBlockIndex.get(index);

    if (!blockInfo) return [];

    if (delta.type === 'thinking_delta') {
      // Anthropic thinking delta
      const thinkingDelta = delta as { type: 'thinking_delta'; thinking: string };
      return [
        this.emitReasoningDelta(
          thinkingDelta.thinking || '',
          `thinking_${this.responseId}_${index}`,
          { outputIndex: index, contentIndex: index },
        ),
      ];
    } else if (delta.type === 'signature_delta') {
      const signatureDelta = delta as { type: 'signature_delta'; signature: string };
      blockInfo.signature = `${blockInfo.signature ?? ''}${signatureDelta.signature ?? ''}`;
      return [];
    } else if (delta.type === 'text_delta') {
      return [
        this.emitTextDelta(delta.text, {
          itemId: `text_${this.responseId}_${index}`,
          outputIndex: index,
          contentIndex: index,
        }),
      ];
    } else if (delta.type === 'input_json_delta') {
      if (blockInfo.type === 'provider_state') {
        blockInfo.jsonChunks?.push(delta.partial_json);
        return [];
      }
      const toolCallId = blockInfo.id || '';
      return [this.emitToolCallArgsDelta(toolCallId, delta.partial_json, blockInfo.name)];
    } else if ((delta as { type: string }).type === 'compaction_delta') {
      const compactionDelta = delta as unknown as {
        type: 'compaction_delta';
        content: string | null;
        encrypted_content: string | null;
      };
      blockInfo.content = compactionDelta.content;
      blockInfo.encryptedContent = compactionDelta.encrypted_content;
      return [];
    }

    return [];
  }

  /**
   * Handle content_block_stop event
   */
  private handleContentBlockStop(event: Anthropic.ContentBlockStopEvent): StreamEvent[] {
    const index = event.index;
    const blockInfo = this.contentBlockIndex.get(index);

    if (!blockInfo) return [];

    // If this was a thinking block, emit reasoning done
    if (blockInfo.type === 'thinking') {
      return [this.emitReasoningDone(`thinking_${this.responseId}_${index}`, {
        ...(blockInfo.signature ? { signature: blockInfo.signature } : {}),
      }, { outputIndex: index })];
    }

    // If this was a tool use block, emit arguments done
    if (blockInfo.type === 'tool_use') {
      return [this.emitToolCallArgsDone(blockInfo.id || '', blockInfo.name)];
    }

    if (blockInfo.type === 'compaction') {
      return [{
        type: StreamEventType.COMPACTION,
        response_id: this.responseId,
        item_id: `compaction_${this.responseId}_${index}`,
        output_index: index,
        encrypted_content: blockInfo.encryptedContent ?? '',
        content: blockInfo.content ?? null,
        signature: blockInfo.signature ?? null,
        ...(blockInfo.toolChanges !== undefined
          ? { provider_metadata: { tool_changes: blockInfo.toolChanges } }
          : {}),
        sequence_number: this.nextSequence(),
      }];
    }

    if (blockInfo.type === 'provider_state' && blockInfo.rawBlock) {
      const data = { ...blockInfo.rawBlock };
      const json = blockInfo.jsonChunks?.join('') ?? '';
      if (json) {
        try {
          data.input = JSON.parse(json);
        } catch {
          data.input = json;
        }
      }
      return [{
        type: StreamEventType.PROVIDER_STATE,
        response_id: this.responseId,
        item_id: `provider_state_${this.responseId}_${index}`,
        output_index: index,
        provider: 'anthropic',
        data,
        sequence_number: this.nextSequence(),
      }];
    }

    return [];
  }

  /**
   * Handle message_delta event (usage info, stop_reason)
   */
  private handleMessageDelta(event: Anthropic.MessageDeltaEvent): StreamEvent[] {
    // Extract usage info (Anthropic sends output_tokens in message_delta)
    // Note: input_tokens is only available in message_start, not in delta
    if (event.usage) {
      this.updateUsage(undefined, event.usage.output_tokens);
      this.updateDetailedUsage(this.mapDetailedUsage(event.usage));
    }

    // Capture stop_reason and stop_details (available in event.delta).
    // stop_details is populated by Anthropic only for refusals and names the
    // classifier that fired — cast defensively since older SDK typings may omit it.
    const delta = event.delta as {
      stop_reason?: string | null;
      stop_sequence?: string | null;
      stop_details?: { type?: string; category?: string | null; explanation?: string | null } | null;
    };
    if (delta.stop_reason) {
      this.stopReason = delta.stop_reason;
    }
    if (delta.stop_details) {
      this.stopDetails = {
        type: delta.stop_details.type,
        category: delta.stop_details.category ?? null,
        explanation: delta.stop_details.explanation ?? null,
      };
    }

    // No events to emit - we'll include usage and status in message_stop
    return [];
  }

  private mapDetailedUsage(usage: Anthropic.Usage | Anthropic.MessageDeltaUsage) {
    const cacheCreation = 'cache_creation' in usage ? usage.cache_creation : null;
    const serverToolUse = usage.server_tool_use;
    const speed = (usage as unknown as { speed?: unknown }).speed;
    return {
      cached_input_tokens: usage.cache_read_input_tokens ?? undefined,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? undefined,
      ...(cacheCreation && {
        cache_creation_details: {
          short_ttl_input_tokens: cacheCreation.ephemeral_5m_input_tokens,
          extended_ttl_input_tokens: cacheCreation.ephemeral_1h_input_tokens,
        },
      }),
      ...(serverToolUse && {
        native_tool_calls: {
          web_search: serverToolUse.web_search_requests,
          web_fetch: serverToolUse.web_fetch_requests,
        },
      }),
      ...((usage as typeof usage & {
        output_tokens_details?: { thinking_tokens?: number } | null;
      }).output_tokens_details?.thinking_tokens !== undefined
        ? {
            output_tokens_details: {
              reasoning_tokens: (usage as typeof usage & {
                output_tokens_details: { thinking_tokens: number };
              }).output_tokens_details.thinking_tokens,
            },
          }
        : {}),
      ...('service_tier' in usage && usage.service_tier
        ? { service_tier: usage.service_tier }
        : {}),
      ...(typeof speed === 'string' ? { speed } : {}),
    };
  }

  /**
   * Handle message_stop event (final event)
   */
  private handleMessageStop(): StreamEvent[] {
    const rawStatus = mapAnthropicStatus(this.stopReason);
    const status: 'completed' | 'failed' | 'incomplete' =
      rawStatus === 'completed' ? 'completed' : rawStatus === 'failed' ? 'failed' : 'incomplete';
    return [this.emitResponseComplete(status, this.stopReason || undefined, this.stopDetails)];
  }
}
