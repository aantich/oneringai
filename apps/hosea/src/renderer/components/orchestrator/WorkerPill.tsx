/**
 * WorkerPill - Compact pill showing a worker's name, status, and current tool.
 */

import React from 'react';
import type { WorkerState } from '../../hooks/useTabContext';

interface WorkerPillProps {
  worker: WorkerState;
  isSelected: boolean;
  onClick: () => void;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '\u2026' : text;
}

export function WorkerPill({ worker, isSelected, onClick }: WorkerPillProps): React.ReactElement {
  const modifier = `worker-pill--${worker.status}`;
  const selectedClass = isSelected ? 'worker-pill--selected' : '';

  return (
    <button
      className={`worker-pill ${modifier} ${selectedClass}`}
      onClick={onClick}
      title={`${worker.name} (${worker.type}) - ${worker.status}`}
      type="button"
    >
      <span className="worker-pill__status" />
      <span className="worker-pill__name">{truncate(worker.name, 15)}</span>
      {worker.status === 'running' && worker.currentTool && (
        <span className="worker-pill__tool">
          {'\u25B8'} {truncate(worker.currentToolDescription ?? worker.currentTool, 20)}
        </span>
      )}
    </button>
  );
}
