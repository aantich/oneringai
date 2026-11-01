/**
 * StreamingText — Renders streaming text with a typing indicator.
 *
 * Displays text that accumulates in real-time during streaming,
 * with an animated cursor to indicate active streaming.
 */

import React, { memo } from 'react';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer.js';
import type { IStreamingTextProps } from './types.js';

export const StreamingText: React.FC<IStreamingTextProps> = memo(
  ({ text, isStreaming = false, renderMarkdown = true, className = '', showCursor = true }) => {
    if (!text && !isStreaming) {
      return null;
    }

    const cursorElement = isStreaming && showCursor && (
      <span className="streaming-cursor" aria-hidden="true">|</span>
    );

    return (
      <div className={`streaming-text ${className}`}>
        {renderMarkdown ? (
          <div className="streaming-text__markdown">
            <MarkdownRenderer content={text} isStreaming={isStreaming} />
            {cursorElement}
          </div>
        ) : (
          <div className="streaming-text__plain">
            {text}
            {cursorElement}
          </div>
        )}
      </div>
    );
  },
);

StreamingText.displayName = 'StreamingText';

export default StreamingText;
