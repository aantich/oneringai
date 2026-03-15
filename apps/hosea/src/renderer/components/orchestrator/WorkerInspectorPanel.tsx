/**
 * WorkerInspectorPanel - Detailed view of a single worker's state, conversation, and context budget.
 * Polls inspectWorker every 2 seconds.
 */

import React, { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { WorkerState } from '../../hooks/useTabContext';

const POLL_INTERVAL_MS = 2000;

interface WorkerInspectorPanelProps {
  instanceId: string;
  worker: WorkerState;
  onBack: () => void;
}

interface InspectionData {
  conversation: Array<{
    type: string;
    role?: string;
    content?: Array<{ type: string; text?: string }>;
  }>;
  context: {
    budget: {
      utilizationPercent: number;
      totalUsed: number;
      maxTokens: number;
    };
  };
  toolStats: Record<string, unknown>;
  execution: Record<string, unknown>;
}

function extractText(content?: Array<{ type: string; text?: string }>): string {
  if (!content || !Array.isArray(content)) return '';
  return content
    .filter((c) => c.type === 'input_text' || c.type === 'output_text')
    .map((c) => c.text ?? '')
    .join('\n');
}

export function WorkerInspectorPanel({
  instanceId,
  worker,
  onBack,
}: WorkerInspectorPanelProps): React.ReactElement {
  const [data, setData] = useState<InspectionData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const result = await window.hosea.agent.inspectWorker(instanceId, worker.registryId);
        if (active) {
          setData(result as InspectionData);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to inspect worker');
        }
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [instanceId, worker.registryId]);

  const statusClass = `worker-inspector__status-dot worker-inspector__status-dot--${worker.status}`;

  return (
    <div className="worker-inspector">
      <div className="worker-inspector__header">
        <button
          className="worker-inspector__back-btn"
          onClick={onBack}
          title="Back to dashboard"
          type="button"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="worker-inspector__info">
          <span className="worker-inspector__name">{worker.name}</span>
          <span className="worker-inspector__type">{worker.type}</span>
          <span className={statusClass} />
          <span className="worker-inspector__model">{worker.model}</span>
        </div>
      </div>

      {error && !data ? (
        <div className="worker-inspector__loading" style={{ color: 'var(--text-secondary)' }}>
          Unable to inspect worker: {error}
        </div>
      ) : !data ? (
        <div className="worker-inspector__loading">Loading...</div>
      ) : (
        <div className="worker-inspector__body">
          {/* Status section */}
          <div className="worker-inspector__section">
            <div className="worker-inspector__section-title">Status</div>
            <div className="worker-inspector__status-grid">
              <span>Turns: {worker.turnCount}</span>
              {worker.status === 'running' && worker.currentTool && (
                <span>Tool: {worker.currentToolDescription ?? worker.currentTool}</span>
              )}
            </div>
          </div>

          {/* Context budget section */}
          {data.context?.budget && (
            <div className="worker-inspector__section">
              <div className="worker-inspector__section-title">Context Budget</div>
              <div className="worker-inspector__budget">
                <div className="worker-inspector__budget-bar">
                  <div
                    className="worker-inspector__budget-fill"
                    style={{ width: `${Math.min(data.context.budget.utilizationPercent, 100)}%` }}
                  />
                </div>
                <span className="worker-inspector__budget-text">
                  {data.context.budget.totalUsed.toLocaleString()} / {data.context.budget.maxTokens.toLocaleString()} tokens
                  ({Math.round(data.context.budget.utilizationPercent)}%)
                </span>
              </div>
            </div>
          )}

          {/* Conversation section */}
          <div className="worker-inspector__section">
            <div className="worker-inspector__section-title">
              Conversation ({data.conversation?.length ?? 0} messages)
            </div>
            <div className="worker-inspector__conversation">
              {data.conversation?.map((msg, i) => {
                if (msg.type !== 'message') return null;
                const role = msg.role ?? 'unknown';
                const text = extractText(msg.content);
                if (!text) return null;
                return (
                  <div
                    key={i}
                    className={`worker-inspector__message worker-inspector__message--${role}`}
                  >
                    <span className="worker-inspector__message-role">{role}</span>
                    <span className="worker-inspector__message-text">{text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
