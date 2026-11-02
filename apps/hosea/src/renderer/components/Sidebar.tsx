import React from 'react';
import { Button, Badge } from 'react-bootstrap';

interface AgentStatus {
  initialized: boolean;
  connector: string | null;
  model: string | null;
  mode: string | null;
}

interface SidebarProps {
  status: AgentStatus;
  onNewSession: () => void;
  onOpenSettings: () => void;
  onOpenSetup: () => void;
}

export function Sidebar({
  status,
  onNewSession,
  onOpenSettings,
  onOpenSetup,
}: SidebarProps): React.ReactElement {
  return (
    <aside className="sidebar bg-dark text-light d-flex flex-column" style={{ width: 260 }}>
      {/* Header */}
      <div className="p-3 border-bottom border-secondary">
        <h5 className="mb-0 d-flex align-items-center">
          <span className="me-2">h</span>
          <Badge bg={status.initialized ? 'success' : 'secondary'} pill>
            {status.initialized ? 'Connected' : 'Offline'}
          </Badge>
        </h5>
        <small className="text-muted">OneRing AI Agent</small>
      </div>

      {/* Status */}
      {status.initialized && (
        <div className="p-3 border-bottom border-secondary">
          <div className="mb-2">
            <small className="text-muted d-block">Connector</small>
            <span>{status.connector}</span>
          </div>
          <div className="mb-2">
            <small className="text-muted d-block">Model</small>
            <span>{status.model}</span>
          </div>
          <div>
            <small className="text-muted d-block">Mode</small>
            <Badge bg="info">{status.mode}</Badge>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="p-3 flex-grow-1">
        <div className="d-grid gap-2">
          <Button
            variant="outline-light"
            size="sm"
            onClick={onNewSession}
            disabled={!status.initialized}
          >
            New Session
          </Button>
          <Button
            variant="outline-light"
            size="sm"
            onClick={onOpenSetup}
          >
            {status.initialized ? 'Change Model' : 'Connect'}
          </Button>
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-top border-secondary">
        <Button
          variant="link"
          className="text-muted p-0"
          onClick={onOpenSettings}
        >
          Settings
        </Button>
      </div>
    </aside>
  );
}
