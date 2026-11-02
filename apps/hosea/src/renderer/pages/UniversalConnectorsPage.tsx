/**
 * UniversalConnectorsPage - Main hub for managing universal connectors
 *
 * Displays all configured connectors with ability to add, edit, delete, and test.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Modal, Form, Alert } from 'react-bootstrap';
import { Plus, Key, Search } from 'lucide-react';
import { PageHeader } from '../components/layout';
import {
  ConnectorCard,
  VendorLogo,
  CredentialsForm,
  prefetchVendorLogos,
} from '../components/connectors';
import { useNavigation } from '../hooks/useNavigation';
import { useConnectorVersion } from '../App';

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

interface VendorInfo {
  id: string;
  name: string;
  category: string;
  docsURL?: string;
  credentialsSetupURL?: string;
  authMethods: Array<{
    id: string;
    name: string;
    type: string;
    description: string;
    requiredFields: string[];
    scopes?: string[];
    scopeDescriptions?: Record<string, string>;
  }>;
}

export function UniversalConnectorsPage(): React.ReactElement {
  const { navigate } = useNavigation();

  const [connectors, setConnectors] = useState<StoredUniversalConnector[]>([]);
  const [vendors, setVendors] = useState<Map<string, VendorInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [testingConnector, setTestingConnector] = useState<string | null>(null);
  const [authorizingConnector, setAuthorizingConnector] = useState<string | null>(null);

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingConnector, setEditingConnector] = useState<StoredUniversalConnector | null>(null);
  const [editCredentials, setEditCredentials] = useState<Record<string, string>>({});
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editBaseURL, setEditBaseURL] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete confirmation state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingConnector, setDeletingConnector] = useState<StoredUniversalConnector | null>(null);

  const connectorVersion = useConnectorVersion();

  // Load connectors and vendor info
  const loadConnectors = useCallback(async () => {
    try {
      const [connectorList, vendorList] = await Promise.all([
        window.hosea.universalConnector.list(),
        window.hosea.universalConnector.listVendors(),
      ]);

      // Filter out built-in connectors (managed by Connections page)
      setConnectors(connectorList.filter(c => c.source !== 'built-in'));
      setVendors(new Map(vendorList.map(v => [v.id, v])));

      // Prefetch logos
      prefetchVendorLogos(connectorList.map(c => c.vendorId));
    } catch (error) {
      console.error('Failed to load connectors:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConnectors();
  }, [loadConnectors, connectorVersion]);

  // Handlers
  const handleAddConnector = () => {
    navigate('connector-catalog');
  };

  const handleEditConnector = (connector: StoredUniversalConnector) => {
    setEditingConnector(connector);
    setEditCredentials({ ...connector.credentials });
    setEditDisplayName(connector.displayName || '');
    setEditBaseURL(connector.baseURL || '');
    setEditError(null);
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editingConnector) return;

    setSaving(true);
    setEditError(null);

    try {
      const result = await window.hosea.universalConnector.update(editingConnector.name, {
        credentials: editCredentials,
        displayName: editDisplayName.trim() || undefined,
        baseURL: editBaseURL.trim() || undefined,
      });

      if (result.success) {
        setShowEditModal(false);
        setEditingConnector(null);
        await loadConnectors();
      } else {
        setEditError(result.error || 'Failed to update connector');
      }
    } catch (error) {
      setEditError(String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConnector = (connector: StoredUniversalConnector) => {
    setDeletingConnector(connector);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingConnector) return;

    try {
      const result = await window.hosea.universalConnector.delete(deletingConnector.name);
      if (result.success) {
        setShowDeleteModal(false);
        setDeletingConnector(null);
        await loadConnectors();
      } else {
        alert(result.error || 'Failed to delete connector');
      }
    } catch (error) {
      alert(String(error));
    }
  };

  const handleTestConnection = async (connector: StoredUniversalConnector) => {
    setTestingConnector(connector.name);
    try {
      const result = await window.hosea.universalConnector.testConnection(connector.name);
      if (!result.success) {
        alert(`Connection test failed: ${result.error}`);
      }
      await loadConnectors();
    } catch (error) {
      alert(`Connection test failed: ${error}`);
    } finally {
      setTestingConnector(null);
    }
  };

  const handleAuthorize = async (connector: StoredUniversalConnector) => {
    setAuthorizingConnector(connector.name);
    try {
      const result = await window.hosea.oauth.startFlow(connector.name);
      if (!result.success) {
        alert(`Authorization failed: ${result.error}`);
      }
      await loadConnectors();
    } catch (error) {
      alert(`Authorization failed: ${error}`);
    } finally {
      setAuthorizingConnector(null);
    }
  };

  // Check if a connector uses OAuth (heuristic: auth method name contains "OAuth")
  const isOAuthConnector = (connector: StoredUniversalConnector): boolean => {
    return connector.authMethodName.toLowerCase().includes('oauth');
  };

  // Get vendor info for a connector
  const getVendorInfo = (vendorId: string): VendorInfo | undefined => {
    return vendors.get(vendorId);
  };

  // Get auth template for editing
  const getAuthTemplate = () => {
    if (!editingConnector) return null;
    const vendor = vendors.get(editingConnector.vendorId);
    return vendor?.authMethods.find(m => m.id === editingConnector.authMethodId);
  };

  if (loading) {
    return (
      <div className="page">
        <PageHeader title="Service connectors" subtitle="Loading..." />
        <div className="page__content">
          <div className="text-center py-5">
            <div className="spinner-border" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page universal-connectors-page">
      <PageHeader
        title="Service connectors"
        subtitle={`${connectors.length} connector${connectors.length !== 1 ? 's' : ''} configured`}
      >
        <Button variant="primary" onClick={handleAddConnector}>
          <Plus size={16} className="me-2" />
          Add Connector
        </Button>
      </PageHeader>

      <div className="page__content">
        {connectors.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">
              <Key size={48} />
            </div>
            <h3 className="empty-state__title">No connectors configured</h3>
            <p className="empty-state__description">
              Universal connectors let you connect to 40+ external services like GitHub, Slack, Stripe, and more.
              Add a connector to enable API tools for your agents.
            </p>
            <Button variant="primary" onClick={handleAddConnector}>
              <Plus size={16} className="me-2" />
              Browse Services
            </Button>
          </div>
        ) : (
          <div className="universal-connectors-page__grid">
            {connectors.map((connector) => {
              const vendorInfo = getVendorInfo(connector.vendorId);
              return (
                <ConnectorCard
                  key={connector.name}
                  connector={connector}
                  onEdit={() => handleEditConnector(connector)}
                  onDelete={() => handleDeleteConnector(connector)}
                  onTest={() => handleTestConnection(connector)}
                  testing={testingConnector === connector.name}
                  docsURL={vendorInfo?.docsURL}
                  onAuthorize={isOAuthConnector(connector) ? () => handleAuthorize(connector) : undefined}
                  authorizing={authorizingConnector === connector.name}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      <Modal show={showEditModal} onHide={() => setShowEditModal(false)} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title className="d-flex align-items-center gap-2">
            {editingConnector && <VendorLogo vendorId={editingConnector.vendorId} size={24} />}
            Edit {editingConnector?.displayName || editingConnector?.vendorName}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {editError && <Alert variant="danger" dismissible onClose={() => setEditError(null)}>{editError}</Alert>}

          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Connector Name</Form.Label>
              <Form.Control
                type="text"
                value={editingConnector?.name || ''}
                disabled
              />
              <Form.Text className="text-muted">
                Connector name cannot be changed
              </Form.Text>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Display Name</Form.Label>
              <Form.Control
                type="text"
                value={editDisplayName}
                onChange={(e) => setEditDisplayName(e.target.value)}
                placeholder={editingConnector?.vendorName}
              />
            </Form.Group>

            <hr />

            <h6 className="mb-3">Credentials</h6>
            {editingConnector && (() => {
              const authTemplate = getAuthTemplate();
              return (
                <CredentialsForm
                  requiredFields={authTemplate?.requiredFields || []}
                  values={editCredentials}
                  onChange={(field, value) => setEditCredentials(prev => ({ ...prev, [field]: value }))}
                  credentialsSetupURL={vendors.get(editingConnector.vendorId)?.credentialsSetupURL}
                  docsURL={vendors.get(editingConnector.vendorId)?.docsURL}
                  availableScopes={authTemplate?.scopes}
                  scopeDescriptions={authTemplate?.scopeDescriptions}
                />
              );
            })()}

            <hr />

            <Form.Group className="mb-3">
              <Form.Label>Base URL (optional)</Form.Label>
              <Form.Control
                type="url"
                value={editBaseURL}
                onChange={(e) => setEditBaseURL(e.target.value)}
                placeholder="Override default API endpoint"
              />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowEditModal(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSaveEdit} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal show={showDeleteModal} onHide={() => setShowDeleteModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Delete Connector</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>
            Are you sure you want to delete <strong>{deletingConnector?.displayName || deletingConnector?.name}</strong>?
          </p>
          <p className="text-muted mb-0">
            This will remove the connector and any agents using it will no longer be able to access this service.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDeleteModal(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleConfirmDelete}>
            Delete
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}

export default UniversalConnectorsPage;
