/**
 * ConnectorCard Component
 *
 * Displays a configured universal connector with status and actions.
 */

import React from 'react';
import { Badge, Button, Dropdown } from 'react-bootstrap';
import {
  CheckCircle,
  AlertCircle,
  HelpCircle,
  MoreVertical,
  Edit2,
  Trash2,
  RefreshCw,
  ExternalLink,
  Cloud,
  Monitor,
  Shield,
  Loader2,
} from 'lucide-react';
import { VendorLogo } from './VendorLogo';

interface StoredUniversalConnector {
  name: string;
  vendorId: string;
  vendorName: string;
  authMethodId: string;
  authMethodName: string;
  credentials: Record<string, string>;
  displayName?: string;
  baseURL?: string;
  createdAt: number;
  updatedAt: number;
  lastTestedAt?: number;
  status: 'active' | 'error' | 'untested';
  legacyServiceType?: string;
  source?: 'local' | 'backend' | 'built-in';
}

interface ConnectorCardProps {
  /** Connector data */
  connector: StoredUniversalConnector;
  /** Handler for edit action */
  onEdit: () => void;
  /** Handler for delete action */
  onDelete: () => void;
  /** Handler for test connection action */
  onTest: () => void;
  /** Whether test is in progress */
  testing?: boolean;
  /** Docs URL from vendor template */
  docsURL?: string;
  /** Handler for OAuth authorization (shown only for OAuth connectors) */
  onAuthorize?: () => void;
  /** Whether authorization is in progress */
  authorizing?: boolean;
}

function getStatusConfig(status: StoredUniversalConnector['status']): {
  icon: React.ReactNode;
  label: string;
  variant: string;
} {
  switch (status) {
    case 'active':
      return {
        icon: <CheckCircle size={12} />,
        label: 'Active',
        variant: 'success',
      };
    case 'error':
      return {
        icon: <AlertCircle size={12} />,
        label: 'Error',
        variant: 'danger',
      };
    case 'untested':
    default:
      return {
        icon: <HelpCircle size={12} />,
        label: 'Untested',
        variant: 'secondary',
      };
  }
}

export function ConnectorCard({
  connector,
  onEdit,
  onDelete,
  onTest,
  testing = false,
  docsURL,
  onAuthorize,
  authorizing = false,
}: ConnectorCardProps): React.ReactElement {
  const statusConfig = getStatusConfig(connector.status);
  const displayName = connector.displayName || connector.vendorName;
  const isRemote = connector.source === 'backend';

  return (
    <div className="connector-card">
      <div className="connector-card__header">
        <VendorLogo vendorId={connector.vendorId} size={40} />
        <div className="connector-card__title">
          <div className="connector-card__name">
            {displayName}
            <Badge bg={statusConfig.variant} className="connector-card__status">
              {statusConfig.icon}
              <span className="ms-1">{statusConfig.label}</span>
            </Badge>
            {connector.source === 'backend' ? (
              <Badge bg="info" className="connector-card__status">
                <Cloud size={10} />
                <span className="ms-1">backend</span>
              </Badge>
            ) : connector.source === 'local' ? (
              <Badge bg="secondary" className="connector-card__status">
                <Monitor size={10} />
                <span className="ms-1">Local</span>
              </Badge>
            ) : null}
          </div>
          <div className="connector-card__subtitle">
            <code>{connector.name}</code>
            <span className="mx-2">•</span>
            <span>{connector.authMethodName}</span>
          </div>
        </div>

        <Dropdown align="end">
          <Dropdown.Toggle
            variant="link"
            className="connector-card__menu-toggle"
            id={`connector-menu-${connector.name}`}
          >
            <MoreVertical size={16} />
          </Dropdown.Toggle>
          <Dropdown.Menu>
            <Dropdown.Item onClick={onTest} disabled={testing}>
              <RefreshCw size={14} className={`me-2 ${testing ? 'spin' : ''}`} />
              Test Connection
            </Dropdown.Item>
            <Dropdown.Item onClick={onEdit}>
              <Edit2 size={14} className="me-2" />
              Edit
            </Dropdown.Item>
            {docsURL && (
              <Dropdown.Item
                as="a"
                href={docsURL}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={14} className="me-2" />
                Documentation
              </Dropdown.Item>
            )}
            <Dropdown.Divider />
            <Dropdown.Item onClick={onDelete} className="text-danger">
              <Trash2 size={14} className="me-2" />
              Delete
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
      </div>

      <div className="connector-card__body">
        {connector.baseURL && (
          <div className="connector-card__detail">
            <span className="connector-card__detail-label">Base URL:</span>
            <code className="connector-card__detail-value">{connector.baseURL}</code>
          </div>
        )}
        {connector.legacyServiceType && (
          <div className="connector-card__detail">
            <span className="connector-card__detail-label">Legacy Service:</span>
            <span className="connector-card__detail-value">{connector.legacyServiceType}</span>
            <Badge bg="info" className="ms-2">Migrated</Badge>
          </div>
        )}
        {connector.lastTestedAt && (
          <div className="connector-card__detail">
            <span className="connector-card__detail-label">Last tested:</span>
            <span className="connector-card__detail-value">
              {new Date(connector.lastTestedAt).toLocaleDateString()}
            </span>
          </div>
        )}
      </div>

      <div className="connector-card__footer">
        <Button variant="outline-secondary" size="sm" onClick={onEdit} disabled={isRemote}>
          <Edit2 size={14} className="me-1" />
          {isRemote ? 'Managed' : 'Edit'}
        </Button>
        {onAuthorize && connector.status !== 'active' && (
          <Button
            variant="outline-warning"
            size="sm"
            onClick={onAuthorize}
            disabled={authorizing}
          >
            {authorizing ? (
              <><Loader2 size={14} className="me-1 spin" />Authorizing...</>
            ) : (
              <><Shield size={14} className="me-1" />Authorize</>
            )}
          </Button>
        )}
        <Button
          variant="outline-primary"
          size="sm"
          onClick={onTest}
          disabled={testing}
        >
          <RefreshCw size={14} className={`me-1 ${testing ? 'spin' : ''}`} />
          {testing ? 'Testing...' : 'Test'}
        </Button>
      </div>
    </div>
  );
}

export default ConnectorCard;
