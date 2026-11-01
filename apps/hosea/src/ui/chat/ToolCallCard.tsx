/**
 * ToolCallCard — Displays tool call information.
 *
 * Merged from:
 * - Hosea's ToolCallDisplay (category colors, icons, inline variant)
 * - v25's ToolCallCard (expandable details, args/result display)
 */

import React, { memo, useState, useCallback } from 'react';
import { Wrench, Check, AlertCircle, Loader, Clock, ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react';
import type { IToolCallCardProps, IToolCallInfo } from './types.js';

// Map tool names to categories and colors
const TOOL_CATEGORIES: Record<string, { category: string; color: string }> = {
  read_file: { category: 'File', color: '#3b82f6' },
  write_file: { category: 'File', color: '#3b82f6' },
  edit_file: { category: 'File', color: '#3b82f6' },
  glob: { category: 'File', color: '#3b82f6' },
  grep: { category: 'File', color: '#3b82f6' },
  list_directory: { category: 'File', color: '#3b82f6' },
  bash: { category: 'Shell', color: '#10b981' },
  web_search: { category: 'Web', color: '#8b5cf6' },
  web_scrape: { category: 'Web', color: '#8b5cf6' },
  web_fetch: { category: 'Web', color: '#8b5cf6' },
  memory_store: { category: 'Memory', color: '#f59e0b' },
  memory_retrieve: { category: 'Memory', color: '#f59e0b' },
  memory_list: { category: 'Memory', color: '#f59e0b' },
  memory_delete: { category: 'Memory', color: '#f59e0b' },
  context_set: { category: 'Context', color: '#ec4899' },
  context_get: { category: 'Context', color: '#ec4899' },
  context_delete: { category: 'Context', color: '#ec4899' },
  context_list: { category: 'Context', color: '#ec4899' },
};

function getToolInfo(name: string): { category: string; color: string } {
  return TOOL_CATEGORIES[name] || { category: 'Tool', color: '#6b7280' };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

function formatJson(obj: unknown, maxLength?: number): string {
  try {
    const json = JSON.stringify(obj, null, 2);
    if (maxLength && json.length > maxLength) {
      return json.slice(0, maxLength) + '\n... (truncated)';
    }
    return json;
  }
  catch { return String(obj); }
}

export const ToolCallCard: React.FC<IToolCallCardProps> = memo(
  ({ tool, expanded: initialExpanded = false, className = '' }) => {
    const [expanded, setExpanded] = useState(initialExpanded);
    const { name, description, status, durationMs, error, args, result } = tool;
    const { category, color } = getToolInfo(name);

    const hasDetails = args || result !== undefined || error;

    const toggleExpand = useCallback(() => {
      if (hasDetails) setExpanded((prev) => !prev);
    }, [hasDetails]);

    const statusIcon = {
      pending: null,
      running: <Loader size={14} className="tool-call__status-icon tool-call__status-icon--spin" />,
      complete: <Check size={14} className="tool-call__status-icon tool-call__status-icon--success" />,
      error: <AlertCircle size={14} className="tool-call__status-icon tool-call__status-icon--error" />,
      approval_pending: <ShieldAlert size={14} className="tool-call__status-icon tool-call__status-icon--warning" />,
    }[status];

    return (
      <div className={`tool-call tool-call--${status} ${className}`}>
        <div
          className="tool-call__header"
          onClick={toggleExpand}
          style={{ cursor: hasDetails ? 'pointer' : 'default' }}
        >
          <div className="tool-call__icon" style={{ backgroundColor: color }}>
            <Wrench size={12} />
          </div>
          <span className="tool-call__category" style={{ color }}>{category}</span>
          <span className="tool-call__name">{name}</span>

          {description && (
            <span className="tool-call__description" title={description}>
              {truncateString(description, 100)}
            </span>
          )}

          <div className="tool-call__status">
            {statusIcon}
            {status === 'complete' && durationMs !== undefined && (
              <span className="tool-call__duration">
                <Clock size={12} />
                {formatDuration(durationMs)}
              </span>
            )}
          </div>

          {error && <span className="tool-call__error-badge">error</span>}

          {hasDetails && (
            <span className="tool-call__chevron">
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          )}
        </div>

        {error && !expanded && (
          <div className="tool-call__error">{error}</div>
        )}

        {expanded && (
          <div className="tool-call__details">
            {args && (
              <div className="tool-call__detail-section">
                <span className="tool-call__detail-label">Args:</span>
                <pre className="tool-call__detail-pre">{formatJson(args)}</pre>
              </div>
            )}
            {error && (
              <div className="tool-call__detail-section">
                <span className="tool-call__detail-label tool-call__detail-label--error">Error:</span>
                <span className="tool-call__error">{error}</span>
              </div>
            )}
            {error && result !== undefined && (
              <div className="tool-call__detail-section">
                <span className="tool-call__detail-label">Result:</span>
                <pre className="tool-call__detail-pre">{formatJson(result)}</pre>
              </div>
            )}
            {!error && status === 'complete' && result !== undefined && (
              <div className="tool-call__detail-section">
                <span className="tool-call__detail-label">Result:</span>
                <pre className="tool-call__detail-pre">{formatJson(result, 2000)}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
);

ToolCallCard.displayName = 'ToolCallCard';

/**
 * Inline tool call display for embedding in message content.
 */
interface InlineToolCallProps {
  name: string;
  description: string;
  status: 'pending' | 'running' | 'complete' | 'error';
}

export function InlineToolCall({ name, description, status }: InlineToolCallProps): React.ReactElement {
  const { category, color } = getToolInfo(name);

  return (
    <span className={`inline-tool-call inline-tool-call--${status}`}>
      <span className="inline-tool-call__badge" style={{ backgroundColor: color }}>
        <Wrench size={10} />
        <span className="inline-tool-call__category">{category}</span>
      </span>
      <span className="inline-tool-call__name">{name}</span>
      {description && (
        <span className="inline-tool-call__description">
          {truncateString(description, 50)}
        </span>
      )}
      {status === 'running' && (
        <Loader size={12} className="inline-tool-call__spinner" />
      )}
    </span>
  );
}

export default ToolCallCard;
