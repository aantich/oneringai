/**
 * ExecutionProgress — Inline progress indicator for agent execution.
 *
 * Shows dynamic header with running tool name or cycling status messages.
 * Collapsed by default, expandable to show full ToolCallCard list.
 *
 * From v25, adapted to use framework-agnostic CSS classes.
 */

import React, { memo, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { CheckCircle, Loader, ChevronDown, ChevronUp } from 'lucide-react';
import { ToolCallCard } from './ToolCallCard.js';
import type { IExecutionProgressProps, IToolCallInfo } from './types.js';

const CYCLING_INITIAL_MESSAGES = [
  'Analyzing your request...',
  'Consulting my expertise...',
  'Processing information...',
  'Considering the details...',
  'Processing your request...',
  'Analyzing the task...',
  'Reviewing the information...',
  'Thinking this through...',
  'Gathering my thoughts...',
  'Focusing on your question...',
];

const CYCLING_PROCESSING_MESSAGES = [
  'Thinking through the best approach...',
  'Coordinating next steps...',
  'Evaluating options...',
  'Working on this...',
  'Piecing this together...',
  'Working through the details...',
  'Evaluating next steps...',
  'Ensuring accuracy...',
  'Reviewing related items...',
  'Verifying assumptions...',
];

const getRandomInterval = () => Math.floor(Math.random() * 3000) + 2000;

const formatToolName = (name: string): string => {
  let display = name.replace(/^(github-EW_|mcp_|v25_)/, '');
  display = display.replace(/_/g, ' ');
  return display;
};

const getActiveDescription = (tools: IToolCallInfo[]): string | null => {
  const running = tools.filter((t) => t.status === 'running');
  if (running.length === 0) return null;
  const latest = running[running.length - 1];
  return latest.description || `Running ${formatToolName(latest.name)}`;
};

export const ExecutionProgress: React.FC<IExecutionProgressProps> = memo(
  ({ tools, activeCount, isComplete }) => {
    const [expanded, setExpanded] = useState(false);
    const [cyclingMessage, setCyclingMessage] = useState(CYCLING_INITIAL_MESSAGES[0]);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (isComplete || activeCount > 0) return;

      const interval = getRandomInterval();
      timerRef.current = setTimeout(() => {
        setCyclingMessage((prev) => {
          const pool = tools.length > 0 ? CYCLING_PROCESSING_MESSAGES : CYCLING_INITIAL_MESSAGES;
          const filtered = pool.filter((m) => m !== prev);
          return filtered[Math.floor(Math.random() * filtered.length)];
        });
      }, interval);

      return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }, [cyclingMessage, isComplete, activeCount, tools.length]);

    useEffect(() => {
      if (tools.length > 0) {
        setCyclingMessage((prev) => {
          if (CYCLING_INITIAL_MESSAGES.includes(prev)) {
            return CYCLING_PROCESSING_MESSAGES[Math.floor(Math.random() * CYCLING_PROCESSING_MESSAGES.length)];
          }
          return prev;
        });
      }
    }, [tools.length > 0]);

    const headerTitle = useMemo(() => {
      if (isComplete) return tools.length === 0 ? 'Finished' : 'Work Summary';
      const activeDesc = getActiveDescription(tools);
      if (activeDesc) return activeDesc;
      return cyclingMessage;
    }, [isComplete, tools, cyclingMessage]);

    const runningToolName = useMemo(() => {
      const running = tools.filter((t) => t.status === 'running');
      return running.length > 0 ? running[running.length - 1].name : null;
    }, [tools]);

    const toggleExpanded = useCallback(() => setExpanded((prev) => !prev), []);

    const hasTools = tools.length > 0;

    return (
      <div className="execution-progress">
        <div
          className="execution-progress__header"
          onClick={hasTools ? toggleExpanded : undefined}
          style={{ cursor: hasTools ? 'pointer' : 'default' }}
        >
          {isComplete ? (
            <CheckCircle size={16} className="execution-progress__icon execution-progress__icon--success" />
          ) : (
            <Loader size={16} className="execution-progress__icon execution-progress__icon--spin" />
          )}

          {!isComplete && runningToolName && (
            <span className="execution-progress__tool-badge">{runningToolName}</span>
          )}

          <span className="execution-progress__title">{headerTitle}</span>

          {!isComplete && tools.length > 1 && (
            <span className="execution-progress__count">({tools.length} tools)</span>
          )}

          {hasTools && (
            <span className="execution-progress__chevron">
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          )}
        </div>

        {expanded && hasTools && (
          <div className="execution-progress__body">
            {tools.map((tool) => (
              <ToolCallCard key={tool.id} tool={tool} />
            ))}
          </div>
        )}
      </div>
    );
  },
);

ExecutionProgress.displayName = 'ExecutionProgress';

export default ExecutionProgress;
