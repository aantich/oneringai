/**
 * Tools Page - View and configure available tools
 *
 * Shows all tools from the oneringai registry.
 * Tools that require connectors can be configured directly from this page.
 * Enable/disable is handled per-agent in the Agent Editor, not here.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Modal, Badge, Form, Alert } from 'react-bootstrap';
import {
  Wrench,
  FileText,
  Terminal,
  Globe,
  Code,
  Braces,
  Plug,
  Shield,
  ShieldAlert,
  Settings,
  ChevronRight,
  Search,
  ExternalLink,
  CheckCircle,
  Plus,
  Key,
} from 'lucide-react';
import { PageHeader } from '../components/layout';
import { useConnectorVersion } from '../App';

interface ToolEntry {
  name: string;
  displayName: string;
  category: string;
  description: string;
  safeByDefault: boolean;
  requiresConnector: boolean;
  connectorServiceTypes?: string[];
}

interface UniversalConnector {
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
  status: 'active' | 'error' | 'untested';
}

// Icons and colors for categories
const categoryInfo: Record<
  string,
  { icon: React.ReactNode; label: string; color: string }
> = {
  filesystem: {
    icon: <FileText size={20} />,
    label: 'Filesystem',
    color: 'var(--color-primary)',
  },
  shell: {
    icon: <Terminal size={20} />,
    label: 'Shell',
    color: 'var(--color-warning)',
  },
  web: {
    icon: <Globe size={20} />,
    label: 'Web',
    color: 'var(--color-success)',
  },
  code: {
    icon: <Code size={20} />,
    label: 'Code Execution',
    color: 'var(--color-danger)',
  },
  json: {
    icon: <Braces size={20} />,
    label: 'JSON',
    color: 'var(--color-info)',
  },
  connector: {
    icon: <Plug size={20} />,
    label: 'Connector',
    color: 'var(--color-secondary)',
  },
  other: {
    icon: <Wrench size={20} />,
    label: 'Other',
    color: 'var(--color-muted)',
  },
};

// Service type display info
const serviceTypeInfo: Record<string, { name: string; docsUrl?: string; defaultBaseURL?: string }> = {
  serper: {
    name: 'Serper (Google Search)',
    docsUrl: 'https://serper.dev',
    defaultBaseURL: 'https://google.serper.dev',
  },
  'brave-search': {
    name: 'Brave Search',
    docsUrl: 'https://brave.com/search/api/',
    defaultBaseURL: 'https://api.search.brave.com/res/v1',
  },
  tavily: {
    name: 'Tavily',
    docsUrl: 'https://tavily.com',
    defaultBaseURL: 'https://api.tavily.com',
  },
  'rapidapi-websearch': {
    name: 'RapidAPI Web Search',
    docsUrl: 'https://rapidapi.com',
    defaultBaseURL: 'https://real-time-web-search.p.rapidapi.com',
  },
  zenrows: {
    name: 'ZenRows',
    docsUrl: 'https://zenrows.com',
    defaultBaseURL: 'https://api.zenrows.com/v1',
  },
};

export function ToolConnectorsPage(): React.ReactElement {
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [universalConnectors, setUniversalConnectors] = useState<UniversalConnector[]>([]);
  const [llmConnectors, setLlmConnectors] = useState<{ name: string; vendor: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTool, setSelectedTool] = useState<ToolEntry | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);

  // Inline connector creation form
  const [showAddConnectorModal, setShowAddConnectorModal] = useState(false);
  const [addingForServiceType, setAddingForServiceType] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formApiKey, setFormApiKey] = useState('');
  const [formBaseURL, setFormBaseURL] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const connectorVersion = useConnectorVersion();

  const loadData = useCallback(async () => {
    try {
      const [registry, uniConns, llmConns] = await Promise.all([
        window.hosea.tool.registry(),
        window.hosea.universalConnector.list(),
        window.hosea.connector.list(),
      ]);
      setTools(Array.isArray(registry) ? registry : []);
      setUniversalConnectors(uniConns);
      setLlmConnectors(llmConns);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData, connectorVersion]);

  // Group tools by category
  const toolsByCategory = tools.reduce(
    (acc, tool) => {
      const category = tool.category || 'other';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(tool);
      return acc;
    },
    {} as Record<string, ToolEntry[]>
  );

  // Filter tools
  const filteredTools = tools.filter((tool) => {
    const matchesCategory = !selectedCategory || tool.category === selectedCategory;
    const matchesSearch =
      !searchQuery ||
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Get unique categories
  const categories = Object.keys(toolsByCategory).sort();

  // Tools requiring connector configuration
  const toolsRequiringConfig = tools.filter((t) => t.requiresConnector);

  // Check if a service type has a configured universal connector
  const getConnectorForServiceType = (serviceType: string): UniversalConnector | undefined => {
    return universalConnectors.find((uc) => uc.vendorId === serviceType);
  };

  // Check if any of the tool's required services are configured
  const isToolConfigured = (tool: ToolEntry): boolean => {
    if (!tool.requiresConnector || !tool.connectorServiceTypes) return true;
    return tool.connectorServiceTypes.some(
      (st) => getConnectorForServiceType(st) || llmConnectors.some((c) => c.vendor === st)
    );
  };

  const handleConfigureTool = (tool: ToolEntry) => {
    setSelectedTool(tool);
    setShowConfigModal(true);
  };

  const handleAddConnector = (serviceType: string) => {
    setAddingForServiceType(serviceType);
    const service = serviceTypeInfo[serviceType];
    setFormName(serviceType);
    setFormApiKey('');
    setFormBaseURL(service?.defaultBaseURL || '');
    setFormError(null);
    setShowAddConnectorModal(true);
  };

  const handleSaveConnector = async () => {
    if (!addingForServiceType || !formName.trim() || !formApiKey.trim()) {
      setFormError('Please fill in all required fields');
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const result = await window.hosea.universalConnector.create({
        name: formName.trim(),
        vendorId: addingForServiceType,
        authMethodId: 'api-key',
        credentials: { apiKey: formApiKey.trim() },
        displayName: serviceTypeInfo[addingForServiceType]?.name,
        baseURL: formBaseURL.trim() || undefined,
      });

      if (result.success) {
        setShowAddConnectorModal(false);
        setAddingForServiceType(null);
        setFormName('');
        setFormApiKey('');
        setFormBaseURL('');
        await loadData();
      } else {
        setFormError(result.error || 'Failed to add connector');
      }
    } catch (error) {
      setFormError(String(error));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <PageHeader title="Tool Catalog" subtitle="Loading tool registry..." />
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
    <div className="page">
      <PageHeader
        title="Tool Catalog"
        subtitle={`${tools.length} tools available from oneringai`}
      />

      <div className="page__content">
        {/* Category Filter */}
        <div className="page-section">
          <h3 className="page-section__title">Categories</h3>
          <div className="grid grid--auto mt-4" style={{ gap: 'var(--spacing-3)' }}>
            <div
              className={`card card--hoverable ${!selectedCategory ? 'card--selected' : ''}`}
              onClick={() => setSelectedCategory(null)}
              style={{ cursor: 'pointer', minWidth: 100 }}
            >
              <div className="card__body text-center py-3">
                <Wrench size={24} className="mb-2" style={{ opacity: 0.6 }} />
                <div className="text-sm font-semibold">All</div>
                <div className="text-xs text-muted">{tools.length}</div>
              </div>
            </div>
            {categories.map((category) => {
              const info = categoryInfo[category] || categoryInfo.other;
              const count = toolsByCategory[category]?.length || 0;
              return (
                <div
                  key={category}
                  className={`card card--hoverable ${selectedCategory === category ? 'card--selected' : ''}`}
                  onClick={() =>
                    setSelectedCategory(selectedCategory === category ? null : category)
                  }
                  style={{ cursor: 'pointer', minWidth: 100 }}
                >
                  <div className="card__body text-center py-3">
                    <div style={{ color: info.color }} className="mb-2">
                      {info.icon}
                    </div>
                    <div className="text-sm font-semibold">{info.label}</div>
                    <div className="text-xs text-muted">{count}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Tools Requiring Configuration */}
        {toolsRequiringConfig.length > 0 && (
          <div className="page-section">
            <div className="page-section__header">
              <div>
                <h3 className="page-section__title">
                  <Settings size={18} className="me-2" />
                  Tools Requiring API Keys
                </h3>
                <p className="page-section__description">
                  Configure API keys to enable these tools
                </p>
              </div>
            </div>
            <div className="list mt-3">
              {toolsRequiringConfig.map((tool) => {
                const info = categoryInfo[tool.category] || categoryInfo.other;
                const configured = isToolConfigured(tool);
                return (
                  <div
                    key={tool.name}
                    className="list__item list__item--clickable"
                    onClick={() => handleConfigureTool(tool)}
                  >
                    <div
                      className="connector-card__icon"
                      style={{
                        backgroundColor: configured
                          ? 'var(--color-success-bg)'
                          : `${info.color}15`,
                        color: configured ? 'var(--color-success)' : info.color,
                        width: 40,
                        height: 40,
                      }}
                    >
                      {configured ? <CheckCircle size={20} /> : info.icon}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold">{tool.displayName}</h4>
                        {configured ? (
                          <Badge bg="success" className="ms-2">
                            <CheckCircle size={12} className="me-1" />
                            Ready
                          </Badge>
                        ) : (
                          <Badge bg="warning" className="ms-2">
                            <Key size={12} className="me-1" />
                            Needs API Key
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted mt-1">{tool.description}</p>
                      <div className="mt-2">
                        <span className="text-xs text-muted">Services: </span>
                        {tool.connectorServiceTypes?.map((type) => {
                          const hasConnector = !!getConnectorForServiceType(type) || llmConnectors.some((c) => c.vendor === type);
                          return (
                            <Badge
                              key={type}
                              bg={hasConnector ? 'success' : 'secondary'}
                              className="me-1"
                            >
                              {hasConnector && <CheckCircle size={10} className="me-1" />}
                              {serviceTypeInfo[type]?.name || type}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                    <ChevronRight size={20} className="text-muted" />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="page-section">
          <div className="page-section__header">
            <div>
              <h3 className="page-section__title">All Tools</h3>
              <p className="page-section__description">
                {filteredTools.length} tool{filteredTools.length !== 1 ? 's' : ''} shown
              </p>
            </div>
            <div className="search-input" style={{ width: 300 }}>
              <Search size={16} className="search-input__icon" />
              <Form.Control
                type="text"
                placeholder="Search tools..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input__control"
              />
            </div>
          </div>

          {/* Tool List */}
          <div className="list mt-4">
            {filteredTools.map((tool) => {
              const info = categoryInfo[tool.category] || categoryInfo.other;
              const configured = isToolConfigured(tool);
              return (
                <div key={tool.name} className="list__item">
                  <div
                    className="connector-card__icon"
                    style={{
                      backgroundColor: `${info.color}15`,
                      color: info.color,
                      width: 40,
                      height: 40,
                    }}
                  >
                    {info.icon}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold">{tool.displayName}</h4>
                      <code className="text-xs" style={{ opacity: 0.6 }}>
                        {tool.name}
                      </code>
                    </div>
                    <p className="text-xs text-muted mt-1">{tool.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {tool.safeByDefault ? (
                      <Badge bg="success" title="Safe by default - no approval required">
                        <Shield size={12} className="me-1" />
                        Safe
                      </Badge>
                    ) : (
                      <Badge bg="warning" title="Requires approval before execution">
                        <ShieldAlert size={12} className="me-1" />
                        Approval
                      </Badge>
                    )}
                    {tool.requiresConnector && (
                      <Badge
                        bg={configured ? 'success' : 'secondary'}
                        title={configured ? 'Configured' : 'Requires API key configuration'}
                      >
                        {configured ? (
                          <CheckCircle size={12} className="me-1" />
                        ) : (
                          <Key size={12} className="me-1" />
                        )}
                        {configured ? 'Configured' : 'API Key'}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {filteredTools.length === 0 && (
            <div className="empty-state mt-4">
              <div className="empty-state__icon">
                <Search size={32} />
              </div>
              <h3 className="empty-state__title">No tools found</h3>
              <p className="empty-state__description">
                Try adjusting your search or category filter.
              </p>
            </div>
          )}
        </div>

        {/* Info Section */}
        <div className="page-section">
          <Alert variant="secondary">
            <strong>Note:</strong> Tool enable/disable settings are configured per-agent in the
            Agent Editor. This page shows all available tools and their API configuration status.
          </Alert>
        </div>
      </div>

      {/* Tool Configuration Modal */}
      <Modal show={showConfigModal} onHide={() => setShowConfigModal(false)} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Configure {selectedTool?.displayName}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedTool && (
            <div>
              <p className="text-muted mb-4">{selectedTool.description}</p>

              <h6>Supported Services</h6>
              <p className="text-sm text-muted mb-3">
                This tool needs at least one of the following services configured.
                Click "Add API Key" to configure a service.
              </p>

              <div className="list">
                {selectedTool.connectorServiceTypes?.map((type) => {
                  const info = serviceTypeInfo[type];
                  const connector = getConnectorForServiceType(type);
                  return (
                    <div key={type} className="list__item">
                      <div className="flex-1">
                        <div className="d-flex align-items-center gap-2">
                          <h6 className="mb-0">{info?.name || type}</h6>
                          {connector && (
                            <Badge bg="success">
                              <CheckCircle size={12} className="me-1" />
                              Configured
                            </Badge>
                          )}
                        </div>
                        {connector ? (
                          <small className="text-muted">
                            Using connector: <code>{connector.name}</code>
                          </small>
                        ) : (
                          info?.docsUrl && (
                            <a
                              href={info.docsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary"
                            >
                              <ExternalLink size={12} className="me-1" />
                              Get API Key
                            </a>
                          )
                        )}
                      </div>
                      {connector ? (
                        <Badge bg="secondary">{type}</Badge>
                      ) : (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            setShowConfigModal(false);
                            handleAddConnector(type);
                          }}
                        >
                          <Plus size={14} className="me-1" />
                          Add API Key
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>

              {isToolConfigured(selectedTool) && (
                <Alert variant="success" className="mt-4">
                  <CheckCircle size={16} className="me-2" />
                  <strong>Ready to use!</strong> This tool has at least one service configured and
                  can be used by agents.
                </Alert>
              )}
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowConfigModal(false)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Add Connector Modal */}
      <Modal
        show={showAddConnectorModal}
        onHide={() => {
          setShowAddConnectorModal(false);
          setAddingForServiceType(null);
        }}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>
            Add {addingForServiceType && (serviceTypeInfo[addingForServiceType]?.name || addingForServiceType)}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            {formError && <Alert variant="danger">{formError}</Alert>}

            <Form.Group className="mb-3">
              <Form.Label>Connector Name</Form.Label>
              <Form.Control
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g., serper-main"
              />
              <Form.Text className="text-muted">
                Unique identifier for this connector
              </Form.Text>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>API Key *</Form.Label>
              <Form.Control
                type="password"
                value={formApiKey}
                onChange={(e) => setFormApiKey(e.target.value)}
                placeholder="Enter your API key"
              />
              {addingForServiceType && serviceTypeInfo[addingForServiceType]?.docsUrl && (
                <Form.Text>
                  Get your API key from{' '}
                  <a
                    href={serviceTypeInfo[addingForServiceType].docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {serviceTypeInfo[addingForServiceType].name}
                  </a>
                </Form.Text>
              )}
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Base URL (optional)</Form.Label>
              <Form.Control
                type="text"
                value={formBaseURL}
                onChange={(e) => setFormBaseURL(e.target.value)}
                placeholder={
                  addingForServiceType
                    ? serviceTypeInfo[addingForServiceType]?.defaultBaseURL || ''
                    : ''
                }
              />
              <Form.Text className="text-muted">
                Override the default API endpoint if needed
              </Form.Text>
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => {
              setShowAddConnectorModal(false);
              setAddingForServiceType(null);
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSaveConnector} disabled={saving}>
            {saving ? 'Saving...' : 'Add API Key'}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
