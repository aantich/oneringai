/**
 * OrchestratorDashboard - Horizontal strip showing the worker team and workspace button.
 */

import React from 'react';
import { Clipboard } from 'lucide-react';
import { WorkerPill } from './WorkerPill';
import type { WorkerState } from '../../hooks/useTabContext';

interface OrchestratorDashboardProps {
  workers: Map<string, WorkerState>;
  selectedWorkerName: string | null;
  onSelectWorker: (name: string) => void;
  workspaceEntryCount: number;
  onShowWorkspace: () => void;
}

export function OrchestratorDashboard({
  workers,
  selectedWorkerName,
  onSelectWorker,
  workspaceEntryCount,
  onShowWorkspace,
}: OrchestratorDashboardProps): React.ReactElement | null {
  if (workers.size === 0) return null;

  const workerList = Array.from(workers.values());

  return (
    <div className="orchestrator-dashboard">
      <div className="orchestrator-dashboard__label">
        Team
        <span className="orchestrator-dashboard__badge">{workers.size}</span>
      </div>

      <div className="orchestrator-dashboard__workers">
        {workerList.map((w) => (
          <WorkerPill
            key={w.name}
            worker={w}
            isSelected={selectedWorkerName === w.name}
            onClick={() => onSelectWorker(w.name)}
          />
        ))}
      </div>

      <button
        className="orchestrator-dashboard__workspace-btn"
        onClick={onShowWorkspace}
        title="Shared Workspace"
        type="button"
      >
        <Clipboard size={16} />
        {workspaceEntryCount > 0 && (
          <span className="orchestrator-dashboard__workspace-count">
            {workspaceEntryCount}
          </span>
        )}
      </button>
    </div>
  );
}
