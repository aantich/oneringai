/**
 * ThinkingBlock — Collapsible display for LLM thinking/reasoning content.
 *
 * NEW component that surfaces the thinking text from thinking-capable models
 * (Claude with extended thinking, OpenAI with reasoning, etc.).
 *
 * - Collapsed: Shows "Thinking..." with chevron, animated dots while streaming
 * - Expanded: Grey-tinted scrollable block with the thinking text
 * - Uses CSS variables on `.thinking-block` for easy theming
 */

import React, { memo, useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, Brain } from 'lucide-react';
import type { IThinkingBlockProps } from './types.js';

export const ThinkingBlock: React.FC<IThinkingBlockProps> = memo(
  ({ content, isStreaming = false, defaultCollapsed = true, className = '' }) => {
    const [collapsed, setCollapsed] = useState(defaultCollapsed);

    const toggle = useCallback(() => setCollapsed((prev) => !prev), []);

    if (!content && !isStreaming) {
      return null;
    }

    return (
      <div className={`thinking-block ${isStreaming ? 'thinking-block--streaming' : ''} ${className}`}>
        <button className="thinking-block__header" onClick={toggle}>
          <Brain size={14} className="thinking-block__icon" />
          <span className="thinking-block__label">
            {isStreaming ? (
              <span className="thinking-block__dots">Thinking</span>
            ) : (
              'Thought process'
            )}
          </span>
          <span className="thinking-block__chevron">
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </span>
        </button>

        {!collapsed && (
          <div className="thinking-block__content">
            <pre className="thinking-block__text">{content}</pre>
          </div>
        )}
      </div>
    );
  },
);

ThinkingBlock.displayName = 'ThinkingBlock';

export default ThinkingBlock;
