/**
 * LLM Connectors Page - Manage LLM provider connections
 */

import React, { useState, useEffect } from 'react';
import { Button, Modal, Form, Alert, Badge, Spinner } from 'react-bootstrap';
import { Plus, Brain, Key, Trash2, Check, Cloud, Monitor, RefreshCw, Globe, Cpu } from 'lucide-react';
import { PageHeader } from '../components/layout';
import { useConnectorVersion } from '../App';

interface ConnectorConfig {
  name: string;
  vendor: string;
  source?: 'local' | 'backend' | 'built-in';
  models?: string[];
  createdAt: number;
}

// Vendor icons and colors - only supported/tested vendors
const vendorInfo: Record<string, { color: string; label: string }> = {
  openai: { color: '#10a37f', label: 'OpenAI' },
  anthropic: { color: '#d4a27f', label: 'Anthropic' },
  google: { color: '#4285f4', label: 'Google' },
  grok: { color: '#1da1f2', label: 'Grok (xAI)' },
  ollama: { color: '#000000', label: 'Ollama' },
};

const isNoAuthVendor = (vendor: string) => vendor === 'ollama';

export function LLMConnectorsPage(): React.ReactElement {
  const [connectors, setConnectors] = useState<ConnectorConfig[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newConnector, setNewConnector] = useState({
    name: '',
    vendor: 'openai',
    apiKey: '',
    baseURL: '',
  });
  const connectorVersion = useConnectorVersion();

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingConnector, setEditingConnector] = useState<ConnectorConfig | null>(null);
  const [editApiKey, setEditApiKey] = useState('');
  const [editBaseURL, setEditBaseURL] = useState('');
  const [editError, setEditError] = useState('');

  // Fetch models state (shared between add and edit modals)
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [addError, setAddError] = useState('');

  useEffect(() => {
    loadConnectors();
  }, [connectorVersion]);

  const loadConnectors = async () => {
    const list = await window.hosea.connector.list();
    setConnectors(list);
  };

  const handleFetchModels = async (vendor: string, apiKey?: string, baseURL?: string, existingConnectorName?: string) => {
    setFetchingModels(true);
    setFetchError('');
    setFetchedModels([]);
    try {
      const result = await window.hosea.connector.fetchModels(
        vendor,
        apiKey || undefined,
        baseURL || undefined,
        existingConnectorName
      );
      if (result.success && result.models) {
        setFetchedModels(result.models);
      } else {
        setFetchError(result.error || 'Failed to fetch models');
      }
    } catch (error) {
      setFetchError(String(error));
    } finally {
      setFetchingModels(false);
    }
  };

  const handleAddConnector = async () => {
    const isNoAuth = isNoAuthVendor(newConnector.vendor);
    if (!newConnector.name || (!isNoAuth && !newConnector.apiKey)) return;

    setAddError('');
    const auth = isNoAuth
      ? { type: 'none' as const }
      : { type: 'api_key' as const, apiKey: newConnector.apiKey };

    const result = await window.hosea.connector.add({
      name: newConnector.name,
      vendor: newConnector.vendor,
      auth,
      baseURL: newConnector.baseURL || undefined,
      models: fetchedModels.length > 0 ? fetchedModels : undefined,
    });

    if (result.success) {
      setShowAddModal(false);
      setNewConnector({ name: '', vendor: 'openai', apiKey: '', baseURL: '' });
      setFetchedModels([]);
      setFetchError('');
      setAddError('');
      loadConnectors();
    } else {
      setAddError(result.error || 'Failed to add provider');
    }
  };

  const handleOpenEditModal = (connector: ConnectorConfig) => {
    setEditingConnector(connector);
    setEditApiKey('');
    setEditBaseURL('');
    setEditError('');
    setFetchedModels(connector.models || []);
    setFetchError('');
    setShowEditModal(true);
  };

  const handleUpdateConnector = async () => {
    if (!editingConnector) return;

    setEditError('');
    const updates: { apiKey?: string; baseURL?: string } = {};
    if (editApiKey) updates.apiKey = editApiKey;
    if (editBaseURL !== '') updates.baseURL = editBaseURL;

    if (Object.keys(updates).length === 0) {
      setEditError('No changes to save');
      return;
    }

    const result = await window.hosea.connector.update(editingConnector.name, updates);
    if (result.success) {
      setShowEditModal(false);
      setEditingConnector(null);
      loadConnectors();
    } else {
      setEditError(result.error || 'Failed to update connector');
    }
  };

  const handleDeleteConnector = async (name: string) => {
    if (!confirm(`Delete connector "${name}"? This cannot be undone.`)) {
      return;
    }

    try {
      const result = await window.hosea.connector.delete(name);
      if (result.success) {
        await loadConnectors();
      } else {
        alert(result.error || 'Failed to delete connector');
      }
    } catch (error) {
      alert(String(error));
    }
  };

  const resetAddModal = () => {
    setShowAddModal(false);
    setNewConnector({ name: '', vendor: 'openai', apiKey: '', baseURL: '' });
    setFetchedModels([]);
    setFetchError('');
    setAddError('');
  };

  const isAddNoAuth = isNoAuthVendor(newConnector.vendor);

  return (
    <div className="page">
      <PageHeader
        title="Model providers"
        subtitle="Manage your AI model provider connections"
      >
        <Button variant="primary" onClick={() => setShowAddModal(true)}>
          <Plus size={16} className="me-2" />
          Add provider
        </Button>
      </PageHeader>

      <div className="page__content">
        {connectors.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">
              <Brain size={32} />
            </div>
            <h3 className="empty-state__title">No providers connected</h3>
            <p className="empty-state__description">
              Connect to an LLM provider like OpenAI, Anthropic, or Google to start
              using AI models in your agents.
            </p>
            <Button variant="primary" onClick={() => setShowAddModal(true)}>
              <Plus size={16} className="me-2" />
              Add provider
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid--auto">
              {connectors.map((connector) => {
                const info = vendorInfo[connector.vendor] || {
                  color: '#64748b',
                  label: connector.vendor,
                };
                const isRemote = connector.source === 'backend';
                const isManagedOllama = connector.name === 'ollama-local' && connector.vendor === 'ollama';
                return (
                  <div key={connector.name} className="card connector-card">
                    <div className="card__body">
                      <div
                        className="connector-card__icon"
                        style={{ backgroundColor: `${info.color}15`, color: info.color }}
                      >
                        {isManagedOllama ? <Cpu size={24} /> : <Brain size={24} />}
                      </div>
                      <h3 className="connector-card__name">{connector.name}</h3>
                      <p className="connector-card__vendor">{info.label}</p>
                      <div className="connector-card__status d-flex gap-2 align-items-center flex-wrap">
                        <span className="badge badge--success">
                          <Check size={12} />
                          Connected
                        </span>
                        {isManagedOllama ? (
                          <Badge bg="success" className="d-flex align-items-center gap-1">
                            <Cpu size={10} />
                            Managed
                          </Badge>
                        ) : isRemote ? (
                          <Badge bg="info" className="d-flex align-items-center gap-1">
                            <Cloud size={10} />
                            backend
                          </Badge>
                        ) : (
                          <Badge bg="secondary" className="d-flex align-items-center gap-1">
                            <Monitor size={10} />
                            Local
                          </Badge>
                        )}
                      </div>
                      {connector.models && connector.models.length > 0 && (
                        <div className="mt-2" style={{ fontSize: '0.75rem' }}>
                          <span className="text-muted">Models: </span>
                          {connector.models.slice(0, 3).map((m) => (
                            <Badge key={m} bg="light" text="dark" className="me-1" style={{ fontSize: '0.7rem' }}>
                              {m}
                            </Badge>
                          ))}
                          {connector.models.length > 3 && (
                            <span className="text-muted">+{connector.models.length - 3} more</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="card__footer">
                      {isManagedOllama ? (
                        <small className="text-muted">{'Managed by hosea \u2014 Settings > Local AI'}</small>
                      ) : !isRemote ? (
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          onClick={() => handleOpenEditModal(connector)}
                        >
                          <Key size={14} className="me-1" />
                          Update Key
                        </Button>
                      ) : (
                        <small className="text-muted">Managed by Backend</small>
                      )}
                      {!isManagedOllama && (
                        <Button
                          variant="outline-danger"
                          size="sm"
                          onClick={() => handleDeleteConnector(connector.name)}
                          title={isRemote ? 'Remove local copy (will return on next sync)' : 'Delete connector'}
                        >
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Hint banner for local AI if no Ollama connector */}
            {connectors.every((c) => c.name !== 'ollama-local') && (
              <div className="mt-3 p-2 text-center text-muted small border rounded">
                <Cpu size={14} className="me-1" />
                {'Want to run AI locally without API keys? Go to '}
                <strong>{'Settings > Local AI'}</strong>
                {' to set up Ollama.'}
              </div>
            )}
          </>
        )}
      </div>

      {/* Add Modal */}
      <Modal show={showAddModal} onHide={resetAddModal} centered>
        <Modal.Header closeButton>
          <Modal.Title>Add model provider</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3">
            <Form.Label>Name</Form.Label>
            <Form.Control
              type="text"
              placeholder="my-openai"
              value={newConnector.name}
              onChange={(e) => setNewConnector({ ...newConnector, name: e.target.value })}
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Provider</Form.Label>
            <Form.Select
              value={newConnector.vendor}
              onChange={(e) => {
                setNewConnector({ ...newConnector, vendor: e.target.value, apiKey: '', baseURL: '' });
                setFetchedModels([]);
                setFetchError('');
              }}
            >
              {Object.entries(vendorInfo).map(([key, info]) => (
                <option key={key} value={key}>
                  {info.label}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
          {!isAddNoAuth && (
            <Form.Group className="mb-3">
              <Form.Label>API Key</Form.Label>
              <Form.Control
                type="password"
                placeholder="sk-..."
                value={newConnector.apiKey}
                onChange={(e) => setNewConnector({ ...newConnector, apiKey: e.target.value })}
              />
            </Form.Group>
          )}
          {(isAddNoAuth || newConnector.vendor === 'ollama') && (
            <Form.Group className="mb-3">
              <Form.Label>
                <Globe size={14} className="me-1" />
                Base URL <span className="text-muted">(optional)</span>
              </Form.Label>
              <Form.Control
                type="text"
                placeholder="http://localhost:11434/v1"
                value={newConnector.baseURL}
                onChange={(e) => setNewConnector({ ...newConnector, baseURL: e.target.value })}
              />
              <Form.Text className="text-muted">
                Leave blank to use the default endpoint
              </Form.Text>
            </Form.Group>
          )}

          {/* Fetch Models */}
          <div className="mb-2">
            <Button
              variant="outline-secondary"
              size="sm"
              disabled={fetchingModels || (!isAddNoAuth && !newConnector.apiKey)}
              onClick={() => handleFetchModels(newConnector.vendor, newConnector.apiKey, newConnector.baseURL)}
            >
              {fetchingModels ? (
                <>
                  <Spinner size="sm" animation="border" className="me-1" />
                  Fetching...
                </>
              ) : (
                <>
                  <RefreshCw size={14} className="me-1" />
                  Fetch Models
                </>
              )}
            </Button>
          </div>
          {fetchError && (
            <Alert variant="warning" className="py-1 px-2 mb-2" style={{ fontSize: '0.8rem' }}>
              {fetchError}
            </Alert>
          )}
          {fetchedModels.length > 0 && (
            <div className="mb-2" style={{ fontSize: '0.8rem', maxHeight: '120px', overflowY: 'auto' }}>
              <span className="text-muted">Available models ({fetchedModels.length}): </span>
              <div className="d-flex flex-wrap gap-1 mt-1">
                {fetchedModels.map((m) => (
                  <Badge key={m} bg="light" text="dark" style={{ fontSize: '0.7rem' }}>
                    {m}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {addError && (
            <Alert variant="danger" className="py-1 px-2 mb-0 mt-2" style={{ fontSize: '0.8rem' }}>
              {addError}
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={resetAddModal}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleAddConnector}
            disabled={!newConnector.name || (!isAddNoAuth && !newConnector.apiKey)}
          >
            Add provider
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Edit Modal */}
      <Modal show={showEditModal} onHide={() => setShowEditModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Update Provider — {editingConnector?.name}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {editingConnector && !isNoAuthVendor(editingConnector.vendor) && (
            <Form.Group className="mb-3">
              <Form.Label>New API Key</Form.Label>
              <Form.Control
                type="password"
                placeholder="Enter new API key..."
                value={editApiKey}
                onChange={(e) => setEditApiKey(e.target.value)}
              />
              <Form.Text className="text-muted">
                Leave blank to keep the existing key
              </Form.Text>
            </Form.Group>
          )}
          {editingConnector && editingConnector.vendor === 'ollama' && (
            <Form.Group className="mb-3">
              <Form.Label>
                <Globe size={14} className="me-1" />
                Base URL
              </Form.Label>
              <Form.Control
                type="text"
                placeholder="http://localhost:11434/v1"
                value={editBaseURL}
                onChange={(e) => setEditBaseURL(e.target.value)}
              />
            </Form.Group>
          )}

          {/* Fetch Models in edit modal */}
          {editingConnector && (
            <div className="mb-2">
              <Button
                variant="outline-secondary"
                size="sm"
                disabled={fetchingModels}
                onClick={() => handleFetchModels(
                  editingConnector.vendor,
                  editApiKey || undefined,
                  editBaseURL || undefined,
                  editingConnector.name
                )}
              >
                {fetchingModels ? (
                  <>
                    <Spinner size="sm" animation="border" className="me-1" />
                    Fetching...
                  </>
                ) : (
                  <>
                    <RefreshCw size={14} className="me-1" />
                    Fetch Models
                  </>
                )}
              </Button>
            </div>
          )}
          {fetchError && (
            <Alert variant="warning" className="py-1 px-2 mb-2" style={{ fontSize: '0.8rem' }}>
              {fetchError}
            </Alert>
          )}
          {fetchedModels.length > 0 && (
            <div className="mb-2" style={{ fontSize: '0.8rem', maxHeight: '120px', overflowY: 'auto' }}>
              <span className="text-muted">Available models ({fetchedModels.length}): </span>
              <div className="d-flex flex-wrap gap-1 mt-1">
                {fetchedModels.map((m) => (
                  <Badge key={m} bg="light" text="dark" style={{ fontSize: '0.7rem' }}>
                    {m}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {editError && (
            <Alert variant="danger" className="py-1 px-2 mb-0 mt-2" style={{ fontSize: '0.8rem' }}>
              {editError}
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowEditModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleUpdateConnector}>
            Save Changes
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
