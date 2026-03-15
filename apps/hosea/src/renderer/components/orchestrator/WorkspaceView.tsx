/**
 * WorkspaceView - Displays shared workspace entries sorted by most recently updated.
 */

import React, { useMemo } from 'react';

interface WorkspaceEntry {
  key: string;
  summary: string;
  status: string;
  author: string;
  version: number;
  updatedAt: number;
}

interface WorkspaceViewProps {
  entries: WorkspaceEntry[];
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function WorkspaceView({ entries }: WorkspaceViewProps): React.ReactElement {
  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.updatedAt - a.updatedAt),
    [entries],
  );

  if (sorted.length === 0) {
    return (
      <div className="workspace-view">
        <div className="workspace-view__empty">
          Workspace is empty. Agents will post shared artifacts here.
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-view">
      {sorted.map((entry) => (
        <div key={entry.key} className="workspace-view__entry">
          <div className="workspace-view__entry-key">{entry.key}</div>
          <div className="workspace-view__entry-summary">{entry.summary}</div>
          <div className="workspace-view__entry-meta">
            <span className="workspace-view__status-badge">{entry.status}</span>
            <span>by {entry.author}</span>
            <span>v{entry.version}</span>
            <span>{formatTime(entry.updatedAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
