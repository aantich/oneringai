/**
 * MessageList — Displays a list of chat messages with rich rendering.
 *
 * Features:
 * - Markdown rendering with math, diagrams, charts, code highlighting
 * - Streaming text support with animated cursor
 * - ThinkingBlock for thinking-capable models
 * - Tool call display
 * - Copy message content
 * - Auto-scroll to bottom
 *
 * Merged from v25 (standalone component) + Hosea (smart auto-scroll).
 */

import React, { memo, useRef, useEffect, useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer.js';
import { RenderErrorBoundary } from '../markdown/RenderErrorBoundary.js';
import { StreamingText } from './StreamingText.js';
import { ThinkingBlock } from './ThinkingBlock.js';
import { ToolCallCard } from './ToolCallCard.js';
import type { IChatMessage, IMessageListProps } from './types.js';
import type { OnInteractiveAction } from '../interactive-ui/types.js';

/**
 * Individual message component with hover controls
 */
const MessageWithControls: React.FC<{
  message: IChatMessage;
  index: number;
  onCopyMessage?: (content: string) => void;
  onInteractiveAction?: OnInteractiveAction;
}> = memo(({ message, index, onCopyMessage, onInteractiveAction }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isAssistant = message.role === 'assistant';

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onCopyMessage?.(message.content);
    } catch (err) {
      console.error('Failed to copy message:', err);
    }
  }, [message.content, onCopyMessage]);

  if (isUser) {
    return (
      <div className="rui-message rui-message--user">
        <div className="rui-message__bubble">{message.content}</div>
      </div>
    );
  }

  if (isSystem) {
    return (
      <div className="rui-message rui-message--system">
        <div className="rui-message__content">
          <small className="rui-message__system-text">{message.content}</small>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rui-message rui-message--assistant"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Thinking block */}
      {message.thinking && (
        <ThinkingBlock
          content={message.thinking}
          isStreaming={message.isStreaming}
        />
      )}

      {/* Tool calls */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="rui-message__tool-calls">
          {message.toolCalls.map((tc) => (
            <ToolCallCard key={tc.id} tool={tc} />
          ))}
        </div>
      )}

      {/* Error */}
      {message.error && (
        <div className="rui-message__error">{message.error}</div>
      )}

      {/* Warning (e.g., truncation) */}
      {message.warning && (
        <div className="rui-message__warning">{message.warning}</div>
      )}

      {/* Retry indicator */}
      {message.retryInfo && message.isStreaming && (
        <div className="rui-message__retry-indicator">
          <svg className="rui-message__retry-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
          <span>Retrying ({message.retryInfo.attempt}/{message.retryInfo.maxAttempts})...</span>
        </div>
      )}

      {/* Content */}
      {message.content && (
        <div className="rui-message__content">
          <RenderErrorBoundary
            rendererType="markdown message"
            fallbackMessage="Error rendering message content"
          >
            <MarkdownRenderer content={message.content} isStreaming={message.isStreaming} onInteractiveAction={onInteractiveAction} />
          </RenderErrorBoundary>
        </div>
      )}

      {/* Timestamp */}
      {message.timestamp && (
        <div className="rui-message__time">
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      )}

      {/* Hover controls */}
      {isAssistant && isHovered && message.content && (
        <div className="rui-message__controls">
          <button
            className="rui-message__control-btn"
            onClick={handleCopy}
            title="Copy markdown content"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>
      )}
    </div>
  );
});

MessageWithControls.displayName = 'MessageWithControls';

/**
 * Main message list component.
 */
export const MessageList: React.FC<IMessageListProps> = memo(
  ({
    messages,
    streamingText = '',
    streamingThinking = '',
    isStreaming = false,
    autoScroll = true,
    hideThinking = false,
    className = '',
    renderMessage,
    onCopyMessage,
    onInteractiveAction,
  }) => {
    const endRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Smart auto-scroll: only scroll when user is near the bottom
    useEffect(() => {
      if (!autoScroll || !containerRef.current) return;

      const container = containerRef.current;
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;

      if (isNearBottom) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      }
    }, [messages, streamingText, streamingThinking, autoScroll]);

    return (
      <div className={`rui-message-list ${className}`} ref={containerRef}>
        {/* Existing messages */}
        {messages.map((message, index) =>
          renderMessage
            ? renderMessage(message, index)
            : (
              <MessageWithControls
                key={message.id || index}
                message={message}
                index={index}
                onCopyMessage={onCopyMessage}
                onInteractiveAction={onInteractiveAction}
              />
            ),
        )}

        {/* Streaming thinking block */}
        {streamingThinking && !hideThinking && (
          <ThinkingBlock content={streamingThinking} isStreaming={isStreaming} />
        )}

        {/* Streaming response */}
        {(streamingText || (isStreaming && !hideThinking && !streamingThinking)) && (
          <div className="rui-message rui-message--assistant">
            <div className="rui-message__content">
              {streamingText ? (
                <StreamingText
                  text={streamingText}
                  isStreaming={isStreaming}
                  renderMarkdown
                />
              ) : (
                isStreaming && (
                  <span className="rui-message__thinking-dots">Thinking</span>
                )
              )}
            </div>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={endRef} />
      </div>
    );
  },
);

MessageList.displayName = 'MessageList';

export default MessageList;
