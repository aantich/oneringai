/**
 * Settings Page - App configuration
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Card, Form, Nav, ButtonGroup, Button, Row, Col, Badge, Spinner, Alert, Modal } from 'react-bootstrap';
import { Monitor, Palette, Bell, Shield, Info, Code, Cloud, RefreshCw, CheckCircle, XCircle, Plus, Pencil, Trash2, Zap, LogIn, User, Clock, Cpu } from 'lucide-react';
import { PageHeader } from '../components/layout';
import { OllamaSetupPanel } from '../components/ollama/OllamaSetupPanel';
import type { EverworkerProfile, EverworkerProfilesConfig } from '../../preload/index';

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

interface AppConfig {
  logLevel: LogLevel;
  ui: {
    theme: 'light' | 'dark' | 'system';
    fontSize: number;
    streamResponses: boolean;
  };
  routines: {
    maxExecutionLogs: number;
  };
}

const defaultConfig: AppConfig = {
  logLevel: 'info',
  ui: {
    theme: 'system',
    fontSize: 14,
    streamResponses: true,
  },
  routines: {
    maxExecutionLogs: 100,
  },
};

function timeAgo(timestamp?: number): string {
  if (!timestamp) return 'Never';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function SettingsPage(): React.ReactElement {
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [activeSection, setActiveSection] = useState('appearance');
  const [appVersion, setAppVersion] = useState('...');

  useEffect(() => {
    loadConfig();
    window.hosea.app.getVersion().then(v => setAppVersion(v));
  }, []);

  const loadConfig = async () => {
    const cfg = (await window.hosea.config.get()) as AppConfig;
    if (cfg) {
      setConfig(cfg);
    }
  };

  const handleConfigChange = async (key: string, value: unknown) => {
    await window.hosea.config.set(key, value);
    loadConfig();
  };

  // ============ Everworker Multi-Profile State ============
  const [ewProfiles, setEwProfiles] = useState<EverworkerProfilesConfig | null>(null);
  const [ewFeedback, setEwFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [switching, setSwitching] = useState(false);
  const [testingProfileId, setTestingProfileId] = useState<string | null>(null);
  const [syncingProfile, setSyncingProfile] = useState(false);

  // Edit/Add modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Partial<EverworkerProfile> | null>(null);
  const [editForm, setEditForm] = useState({ name: '', url: '', token: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [showManualToken, setShowManualToken] = useState(false);

  // Browser auth state
  const [authInProgress, setAuthInProgress] = useState(false);
  const [authMetadata, setAuthMetadata] = useState<{
    tokenExpiresAt?: number;
    tokenIssuedAt?: number;
    userName?: string;
    userId?: string;
    authMethod?: 'manual' | 'browser-auth';
  } | null>(null);
  const [reauthProfileId, setReauthProfileId] = useState<string | null>(null);

  // Delete confirmation
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);

  const loadEWProfiles = useCallback(async () => {
    const profiles = await window.hosea.everworker.getProfiles();
    setEwProfiles(profiles);
  }, []);

  useEffect(() => {
    if (activeSection === 'everworker') {
      loadEWProfiles();
    }
  }, [activeSection, loadEWProfiles]);

  const handleSwitchProfile = async (profileId: string | null) => {
    setSwitching(true);
    setEwFeedback(null);
    try {
      const result = await window.hosea.everworker.switchProfile(profileId);
      if (result.success) {
        setEwFeedback({
          success: true,
          message: profileId
            ? `Switched profile: ${result.added ?? 0} connectors synced, ${result.removed ?? 0} removed.`
            : 'Disconnected from Everworker backend.',
        });
      } else {
        setEwFeedback({ success: false, message: result.error || 'Switch failed.' });
      }
      await loadEWProfiles();
    } catch (error) {
      setEwFeedback({ success: false, message: String(error) });
    }
    setSwitching(false);
  };

  const handleTestProfile = async (id: string) => {
    setTestingProfileId(id);
    setEwFeedback(null);
    try {
      const result = await window.hosea.everworker.testProfile(id);
      if (result.success) {
        setEwFeedback({
          success: true,
          message: `Connection successful! ${result.connectorCount} connector(s) available.`,
        });
      } else {
        setEwFeedback({ success: false, message: result.error || 'Connection failed.' });
      }
    } catch (error) {
      setEwFeedback({ success: false, message: String(error) });
    }
    setTestingProfileId(null);
  };

  const handleSyncActive = async () => {
    setSyncingProfile(true);
    setEwFeedback(null);
    try {
      const result = await window.hosea.everworker.syncActive();
      if (result.success) {
        setEwFeedback({
          success: true,
          message: `Sync complete: ${result.added ?? 0} added, ${result.updated ?? 0} updated, ${result.removed ?? 0} removed.`,
        });
      } else {
        setEwFeedback({ success: false, message: result.error || 'Sync failed.' });
      }
      await loadEWProfiles();
    } catch (error) {
      setEwFeedback({ success: false, message: String(error) });
    }
    setSyncingProfile(false);
  };

  const openAddModal = () => {
    setEditingProfile(null);
    setEditForm({ name: '', url: '', token: '' });
    setAuthMetadata(null);
    setShowManualToken(false);
    setShowEditModal(true);
  };

  const openEditModal = (profile: EverworkerProfile) => {
    setEditingProfile(profile);
    setEditForm({ name: profile.name, url: profile.url, token: profile.token });
    setAuthMetadata(null);
    setShowManualToken(profile.authMethod === 'manual' || !profile.authMethod);
    setShowEditModal(true);
  };

  const handleBrowserAuth = async () => {
    const url = editForm.url?.trim();
    if (!url) return;

    setAuthInProgress(true);
    setEwFeedback(null);
    try {
      // First check if this EW instance supports browser auth
      const support = await window.hosea.everworker.checkAuthSupport(url);
      if (!support.supported) {
        setEwFeedback({
          success: false,
          message: 'This EverWorker instance does not support browser login yet. Please enter a token manually.',
        });
        setShowManualToken(true);
        setAuthInProgress(false);
        return;
      }

      // Open the auth window
      const result = await window.hosea.everworker.startAuth(url);
      if (result.success && result.token) {
        setEditForm(f => ({ ...f, token: result.token! }));
        setAuthMetadata({
          tokenExpiresAt: result.expiresAt,
          tokenIssuedAt: Date.now(),
          userName: result.userName,
          userId: result.userId,
          authMethod: 'browser-auth',
        });
        setEwFeedback({ success: true, message: `Authenticated as ${result.userName || 'user'}` });
      } else {
        setEwFeedback({ success: false, message: result.error || 'Authentication failed' });
      }
    } catch (error) {
      setEwFeedback({ success: false, message: String(error) });
    }
    setAuthInProgress(false);
  };

  const handleReauth = async (profile: EverworkerProfile) => {
    setReauthProfileId(profile.id);
    setEwFeedback(null);
    try {
      const support = await window.hosea.everworker.checkAuthSupport(profile.url);
      if (!support.supported) {
        setEwFeedback({ success: false, message: 'This EverWorker instance does not support browser login. Please edit the profile and enter a new token manually.' });
        setReauthProfileId(null);
        return;
      }

      const result = await window.hosea.everworker.startAuth(profile.url);
      if (result.success && result.token) {
        await window.hosea.everworker.updateProfile(profile.id, {
          token: result.token,
          tokenExpiresAt: result.expiresAt,
          tokenIssuedAt: Date.now(),
          userName: result.userName,
          userId: result.userId,
          authMethod: 'browser-auth',
        });
        setEwFeedback({ success: true, message: `Re-authenticated as ${result.userName || 'user'}` });
        await loadEWProfiles();
      } else {
        setEwFeedback({ success: false, message: result.error || 'Re-authentication failed' });
      }
    } catch (error) {
      setEwFeedback({ success: false, message: String(error) });
    }
    setReauthProfileId(null);
  };

  const handleSaveProfile = async () => {
    setEditSaving(true);
    try {
      const profileData = {
        ...editForm,
        ...(authMetadata || {}),
        // If no authMetadata and token was manually entered, mark as manual
        ...(!authMetadata && editForm.token ? { authMethod: 'manual' as const } : {}),
      };

      if (editingProfile?.id) {
        // Update
        const result = await window.hosea.everworker.updateProfile(editingProfile.id, profileData);
        if (!result.success) {
          setEwFeedback({ success: false, message: result.error || 'Update failed.' });
          setEditSaving(false);
          return;
        }
      } else {
        // Add
        const result = await window.hosea.everworker.addProfile(profileData);
        if (!result.success) {
          setEwFeedback({ success: false, message: result.error || 'Add failed.' });
          setEditSaving(false);
          return;
        }
      }
      setShowEditModal(false);
      setAuthMetadata(null);
      await loadEWProfiles();
    } catch (error) {
      setEwFeedback({ success: false, message: String(error) });
    }
    setEditSaving(false);
  };

  const handleDeleteProfile = async (id: string) => {
    setDeletingProfileId(null);
    try {
      const result = await window.hosea.everworker.deleteProfile(id);
      if (!result.success) {
        setEwFeedback({ success: false, message: result.error || 'Delete failed.' });
      } else {
        setEwFeedback({ success: true, message: 'Profile deleted.' });
      }
      await loadEWProfiles();
    } catch (error) {
      setEwFeedback({ success: false, message: String(error) });
    }
  };

  const sections = [
    { id: 'appearance', label: 'Appearance', icon: <Palette size={18} /> },
    { id: 'behavior', label: 'Behavior', icon: <Monitor size={18} /> },
    { id: 'local-ai', label: 'Local AI', icon: <Cpu size={18} /> },
    { id: 'everworker', label: 'Everworker Backend', icon: <Cloud size={18} /> },
    { id: 'developer', label: 'Developer', icon: <Code size={18} /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell size={18} /> },
    { id: 'privacy', label: 'Privacy', icon: <Shield size={18} /> },
    { id: 'about', label: 'About', icon: <Info size={18} /> },
  ];

  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="Configure your Everworker Desktop experience" />

      <div className="page__content">
        <Row>
          {/* Sidebar */}
          <Col md={3} lg={2}>
            <Nav variant="pills" className="flex-column">
              {sections.map((section) => (
                <Nav.Item key={section.id}>
                  <Nav.Link
                    active={activeSection === section.id}
                    onClick={() => setActiveSection(section.id)}
                    className="d-flex align-items-center gap-2"
                  >
                    {section.icon}
                    {section.label}
                  </Nav.Link>
                </Nav.Item>
              ))}
            </Nav>
          </Col>

          {/* Content */}
          <Col md={9} lg={10}>
            {activeSection === 'appearance' && (
              <div>
                <h3 className="h5 mb-1">Appearance</h3>
                <p className="text-muted mb-4">Customize how Everworker Desktop looks</p>

                <Card>
                  <Card.Body>
                    <Form.Group className="mb-4">
                      <Form.Label>Theme</Form.Label>
                      <div>
                        <ButtonGroup>
                          {['light', 'dark', 'system'].map((theme) => (
                            <Button
                              key={theme}
                              variant={config.ui.theme === theme ? 'primary' : 'outline-secondary'}
                              onClick={() => handleConfigChange('ui.theme', theme)}
                            >
                              {theme.charAt(0).toUpperCase() + theme.slice(1)}
                            </Button>
                          ))}
                        </ButtonGroup>
                      </div>
                    </Form.Group>

                    <Form.Group>
                      <Form.Label>Font Size: {config.ui.fontSize}px</Form.Label>
                      <Form.Range
                        min={12}
                        max={20}
                        value={config.ui.fontSize}
                        onChange={(e) =>
                          handleConfigChange('ui.fontSize', parseInt(e.target.value))
                        }
                        style={{ maxWidth: 300 }}
                      />
                    </Form.Group>
                  </Card.Body>
                </Card>
              </div>
            )}

            {activeSection === 'behavior' && (
              <div>
                <h3 className="h5 mb-1">Behavior</h3>
                <p className="text-muted mb-4">Configure how the app behaves</p>

                <Card>
                  <Card.Body>
                    <Form.Check
                      type="switch"
                      id="stream-responses"
                      label="Stream responses"
                      checked={config.ui.streamResponses}
                      onChange={(e) =>
                        handleConfigChange('ui.streamResponses', e.target.checked)
                      }
                    />
                    <Form.Text className="text-muted">
                      Show AI responses as they are generated
                    </Form.Text>

                    <hr className="my-3" />

                    <Form.Group className="mb-0">
                      <Form.Label>
                        Max routine execution logs: {config.routines?.maxExecutionLogs ?? 100}
                      </Form.Label>
                      <Form.Range
                        min={10}
                        max={500}
                        step={10}
                        value={config.routines?.maxExecutionLogs ?? 100}
                        onChange={(e) =>
                          handleConfigChange('routines.maxExecutionLogs', parseInt(e.target.value))
                        }
                        style={{ maxWidth: 300 }}
                      />
                      <Form.Text className="text-muted">
                        Older completed/failed execution logs are automatically deleted when the limit is reached
                      </Form.Text>
                    </Form.Group>
                  </Card.Body>
                </Card>
              </div>
            )}

            {activeSection === 'local-ai' && (
              <div>
                <h3 className="h5 mb-1">Local AI</h3>
                <p className="text-muted mb-4">
                  Run AI models locally on your machine using Ollama. No API keys or cloud services needed.
                </p>
                <OllamaSetupPanel />
              </div>
            )}

            {activeSection === 'everworker' && (
              <div>
                <h3 className="h5 mb-1">Everworker Backend</h3>
                <p className="text-muted mb-4">
                  Manage EW backend profiles for centrally managed AI connectors.
                </p>

                {/* Active profile selector + Add button */}
                <Card className="mb-3">
                  <Card.Body>
                    <div className="d-flex align-items-center gap-3">
                      <Form.Group className="flex-grow-1 mb-0">
                        <Form.Label className="small text-muted mb-1">Active Profile</Form.Label>
                        <Form.Select
                          value={ewProfiles?.activeProfileId ?? ''}
                          onChange={(e) => handleSwitchProfile(e.target.value || null)}
                          disabled={switching}
                        >
                          <option value="">None (Disconnected)</option>
                          {ewProfiles?.profiles.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </Form.Select>
                      </Form.Group>
                      <div style={{ paddingTop: 20 }}>
                        <Button variant="outline-primary" size="sm" onClick={openAddModal}>
                          <Plus size={16} className="me-1" />
                          Add New
                        </Button>
                      </div>
                    </div>
                    {switching && (
                      <div className="mt-2 text-muted small">
                        <Spinner animation="border" size="sm" className="me-2" />
                        Switching profile...
                      </div>
                    )}
                  </Card.Body>
                </Card>

                {/* Feedback alert */}
                {ewFeedback && (
                  <Alert
                    variant={ewFeedback.success ? 'success' : 'danger'}
                    className="mb-3"
                    dismissible
                    onClose={() => setEwFeedback(null)}
                  >
                    {ewFeedback.success ? (
                      <CheckCircle size={16} className="me-2" />
                    ) : (
                      <XCircle size={16} className="me-2" />
                    )}
                    {ewFeedback.message}
                  </Alert>
                )}

                {/* Profile cards */}
                {ewProfiles?.profiles.map((profile) => {
                  const isActive = ewProfiles.activeProfileId === profile.id;
                  return (
                    <Card key={profile.id} className={`mb-2 ${isActive ? 'border-primary' : ''}`}>
                      <Card.Body className="py-2 px-3">
                        <div className="d-flex justify-content-between align-items-start">
                          <div>
                            <div className="d-flex align-items-center gap-2 mb-1">
                              <strong>{profile.name}</strong>
                              {isActive && <Badge bg="primary">ACTIVE</Badge>}
                              {profile.userName && (
                                <span className="text-muted small d-flex align-items-center gap-1">
                                  <User size={12} />{profile.userName}
                                </span>
                              )}
                              {/* Token status badge */}
                              {(() => {
                                if (!profile.tokenExpiresAt) return null;
                                const msRemaining = profile.tokenExpiresAt - Date.now();
                                const daysRemaining = Math.max(0, Math.floor(msRemaining / (24 * 60 * 60 * 1000)));
                                if (msRemaining <= 0) {
                                  return <Badge bg="danger">Token expired</Badge>;
                                }
                                if (daysRemaining <= 3) {
                                  return <Badge bg="warning" text="dark">Expires in {daysRemaining}d</Badge>;
                                }
                                return null;
                              })()}
                            </div>
                            <div className="text-muted small">{profile.url}</div>
                            <div className="text-muted small">
                              {profile.lastSyncConnectorCount != null
                                ? `${profile.lastSyncConnectorCount} connectors`
                                : 'Not synced'}
                              {' | '}
                              Last synced: {timeAgo(profile.lastSyncedAt)}
                            </div>
                          </div>
                          <div className="d-flex gap-1 flex-shrink-0">
                            {/* Re-authenticate button for expired/expiring tokens */}
                            {profile.tokenExpiresAt && (profile.tokenExpiresAt - Date.now() < 3 * 24 * 60 * 60 * 1000) && (
                              <Button
                                variant={profile.tokenExpiresAt <= Date.now() ? 'outline-danger' : 'outline-warning'}
                                size="sm"
                                onClick={() => handleReauth(profile)}
                                disabled={reauthProfileId === profile.id}
                                title="Re-authenticate"
                              >
                                {reauthProfileId === profile.id ? (
                                  <Spinner animation="border" size="sm" />
                                ) : (
                                  <LogIn size={14} />
                                )}
                              </Button>
                            )}
                            <Button
                              variant="outline-secondary"
                              size="sm"
                              onClick={() => handleTestProfile(profile.id)}
                              disabled={testingProfileId === profile.id}
                              title="Test connection"
                            >
                              {testingProfileId === profile.id ? (
                                <Spinner animation="border" size="sm" />
                              ) : (
                                <CheckCircle size={14} />
                              )}
                            </Button>
                            {isActive && (
                              <Button
                                variant="outline-secondary"
                                size="sm"
                                onClick={handleSyncActive}
                                disabled={syncingProfile}
                                title="Sync connectors"
                              >
                                {syncingProfile ? (
                                  <Spinner animation="border" size="sm" />
                                ) : (
                                  <RefreshCw size={14} />
                                )}
                              </Button>
                            )}
                            {!isActive && (
                              <Button
                                variant="outline-primary"
                                size="sm"
                                onClick={() => handleSwitchProfile(profile.id)}
                                disabled={switching}
                                title="Activate"
                              >
                                <Zap size={14} />
                              </Button>
                            )}
                            <Button
                              variant="outline-secondary"
                              size="sm"
                              onClick={() => openEditModal(profile)}
                              title="Edit"
                            >
                              <Pencil size={14} />
                            </Button>
                            <Button
                              variant="outline-danger"
                              size="sm"
                              onClick={() => setDeletingProfileId(profile.id)}
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </div>
                      </Card.Body>
                    </Card>
                  );
                })}

                {ewProfiles && ewProfiles.profiles.length === 0 && (
                  <Card className="mb-3">
                    <Card.Body className="text-center text-muted py-4">
                      No profiles configured. Click "Add New" to connect to an Everworker backend.
                    </Card.Body>
                  </Card>
                )}

                {/* How it works */}
                <Card className="mt-3">
                  <Card.Body>
                    <h6 className="mb-2">How it works</h6>
                    <ul className="text-muted small mb-0">
                      <li>API keys for AI providers (OpenAI, Anthropic, etc.) are managed centrally on the Everworker server</li>
                      <li>Your desktop app connects through the EW proxy - no API keys stored locally</li>
                      <li>Both local and Everworker connectors can coexist (mixed mode)</li>
                      <li>Everworker connectors appear with a <Badge bg="info" className="ms-1">EW</Badge> badge in the connectors list</li>
                      <li>Switching profiles immediately purges old connectors and syncs new ones</li>
                      <li>Usage is tracked per user on the backend</li>
                    </ul>
                  </Card.Body>
                </Card>

                {/* Add/Edit Profile Modal */}
                <Modal show={showEditModal} onHide={() => { setShowEditModal(false); setAuthMetadata(null); }} centered>
                  <Modal.Header closeButton>
                    <Modal.Title>{editingProfile?.id ? 'Edit Profile' : 'Add Profile'}</Modal.Title>
                  </Modal.Header>
                  <Modal.Body>
                    <Form.Group className="mb-3">
                      <Form.Label>Profile Name</Form.Label>
                      <Form.Control
                        type="text"
                        placeholder="e.g., Production, Staging"
                        value={editForm.name}
                        onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))}
                      />
                    </Form.Group>
                    <Form.Group className="mb-3">
                      <Form.Label>Backend URL</Form.Label>
                      <Form.Control
                        type="url"
                        placeholder="https://ew.company.com"
                        value={editForm.url}
                        onChange={(e) => setEditForm(f => ({ ...f, url: e.target.value }))}
                      />
                    </Form.Group>

                    {/* Browser auth: primary method */}
                    {authMetadata ? (
                      <Alert variant="success" className="mb-3">
                        <div className="d-flex align-items-center gap-2">
                          <CheckCircle size={16} />
                          <span>Authenticated as <strong>{authMetadata.userName || 'user'}</strong></span>
                        </div>
                        {authMetadata.tokenExpiresAt && (
                          <div className="text-muted small mt-1">
                            <Clock size={12} className="me-1" />
                            Token expires: {new Date(authMetadata.tokenExpiresAt).toLocaleDateString()}
                          </div>
                        )}
                      </Alert>
                    ) : (
                      <div className="mb-3">
                        <Button
                          variant="primary"
                          className="w-100"
                          onClick={handleBrowserAuth}
                          disabled={!editForm.url?.trim() || authInProgress}
                        >
                          {authInProgress ? (
                            <>
                              <Spinner animation="border" size="sm" className="me-2" />
                              Waiting for login...
                            </>
                          ) : (
                            <>
                              <LogIn size={16} className="me-2" />
                              Login to EverWorker
                            </>
                          )}
                        </Button>
                        {!editForm.url?.trim() && (
                          <Form.Text className="text-muted">Enter a backend URL first</Form.Text>
                        )}
                      </div>
                    )}

                    {/* Manual token fallback */}
                    {!authMetadata && (
                      <div className="mb-3">
                        {!showManualToken ? (
                          <button
                            type="button"
                            className="btn btn-link btn-sm text-muted p-0"
                            onClick={() => setShowManualToken(true)}
                          >
                            Advanced: Enter token manually
                          </button>
                        ) : (
                          <Form.Group>
                            <Form.Label className="small">JWT Token</Form.Label>
                            <Form.Control
                              type="password"
                              placeholder="eyJhbGciOiJ..."
                              value={editForm.token}
                              onChange={(e) => setEditForm(f => ({ ...f, token: e.target.value }))}
                            />
                            <Form.Text className="text-muted">
                              A JWT token with <code>llm:proxy</code> scope. Generate one in EverWorker under Profile &gt; API Tokens.
                            </Form.Text>
                          </Form.Group>
                        )}
                      </div>
                    )}
                  </Modal.Body>
                  <Modal.Footer>
                    <Button variant="secondary" onClick={() => { setShowEditModal(false); setAuthMetadata(null); }}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      onClick={handleSaveProfile}
                      disabled={editSaving || !editForm.name || !editForm.url || !editForm.token}
                    >
                      {editSaving ? <Spinner animation="border" size="sm" className="me-2" /> : null}
                      {editingProfile?.id ? 'Save Changes' : 'Add Profile'}
                    </Button>
                  </Modal.Footer>
                </Modal>

                {/* Delete Confirmation Modal */}
                <Modal show={!!deletingProfileId} onHide={() => setDeletingProfileId(null)} centered>
                  <Modal.Header closeButton>
                    <Modal.Title>Delete Profile</Modal.Title>
                  </Modal.Header>
                  <Modal.Body>
                    Are you sure you want to delete this profile?
                    {ewProfiles?.activeProfileId === deletingProfileId && (
                      <Alert variant="warning" className="mt-2 mb-0">
                        This is the active profile. Deleting it will disconnect and remove all synced connectors.
                      </Alert>
                    )}
                  </Modal.Body>
                  <Modal.Footer>
                    <Button variant="secondary" onClick={() => setDeletingProfileId(null)}>
                      Cancel
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => deletingProfileId && handleDeleteProfile(deletingProfileId)}
                    >
                      Delete
                    </Button>
                  </Modal.Footer>
                </Modal>
              </div>
            )}

            {activeSection === 'developer' && (
              <div>
                <h3 className="h5 mb-1">Developer Settings</h3>
                <p className="text-muted mb-4">Options for debugging and development</p>

                <Card>
                  <Card.Body>
                    <Form.Group className="mb-4">
                      <Form.Label>Log Level</Form.Label>
                      <Form.Select
                        value={config.logLevel}
                        onChange={(e) =>
                          handleConfigChange('logLevel', e.target.value as LogLevel)
                        }
                        style={{ maxWidth: 200 }}
                      >
                        <option value="trace">Trace</option>
                        <option value="debug">Debug</option>
                        <option value="info">Info</option>
                        <option value="warn">Warn</option>
                        <option value="error">Error</option>
                        <option value="silent">Silent</option>
                      </Form.Select>
                      <Form.Text className="text-muted">
                        Set the verbosity of logs in the terminal. Debug level is recommended during development.
                      </Form.Text>
                    </Form.Group>
                  </Card.Body>
                </Card>
              </div>
            )}

            {activeSection === 'notifications' && (
              <div>
                <h3 className="h5 mb-1">Notifications</h3>
                <p className="text-muted mb-4">Manage notification preferences</p>

                <Card>
                  <Card.Body>
                    <p className="text-muted text-center mb-0">Notification settings coming soon...</p>
                  </Card.Body>
                </Card>
              </div>
            )}

            {activeSection === 'privacy' && (
              <div>
                <h3 className="h5 mb-1">Privacy</h3>
                <p className="text-muted mb-4">Control your data and privacy</p>

                <Card>
                  <Card.Body>
                    <p className="text-muted text-center mb-0">Privacy settings coming soon...</p>
                  </Card.Body>
                </Card>
              </div>
            )}

            {activeSection === 'about' && (
              <div>
                <h3 className="h5 mb-1">About Everworker Desktop</h3>
                <p className="text-muted mb-4">AI Agent Desktop Application by Everworker.ai</p>

                <Card>
                  <Card.Body className="text-center">
                    <div
                      className="sidebar__logo mx-auto mb-3"
                      style={{ width: 60, height: 60, fontSize: 24 }}
                    >
                      EW
                    </div>
                    <h4>Everworker Desktop</h4>
                    <p className="text-muted mb-4">Version {appVersion}</p>

                    <table className="table table-sm mb-0">
                      <tbody>
                        <tr>
                          <td className="text-muted">Built with</td>
                          <td>oneringai</td>
                        </tr>
                        <tr>
                          <td className="text-muted">Electron</td>
                          <td>29.0.0</td>
                        </tr>
                        <tr>
                          <td className="text-muted">React</td>
                          <td>18.2.0</td>
                        </tr>
                      </tbody>
                    </table>
                  </Card.Body>
                </Card>
              </div>
            )}
          </Col>
        </Row>
      </div>
    </div>
  );
}
