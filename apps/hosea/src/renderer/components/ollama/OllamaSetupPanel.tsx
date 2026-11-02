/**
 * OllamaSetupPanel - Reusable component for Ollama setup and management
 *
 * Used in both Settings > Local AI and SetupModal onboarding flow.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Card, Form, Alert, Spinner, ProgressBar, Badge, Table } from 'react-bootstrap';
import { Download, Play, Square, Trash2, RefreshCw, CheckCircle, AlertCircle, Cpu, HardDrive, ExternalLink } from 'lucide-react';

// Types mirrored from OllamaService (main process) — avoid importing Node.js code into renderer
interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modifiedAt: string;
}

interface OllamaState {
  status: 'not_installed' | 'downloading' | 'installed' | 'starting' | 'running' | 'stopped' | 'error';
  isExternalInstance: boolean;
  externalBinaryPath?: string;
  version: string;
  autoStart: boolean;
  models: OllamaModel[];
  error?: string;
  downloadProgress?: { percent: number; downloaded: number; total: number };
  pullProgress?: { model: string; percent: number; status: string };
  systemInfo: {
    totalRAMGB: number;
    platform: string;
    arch: string;
    recommendedModel: string;
    recommendedModelReason: string;
  };
}

interface OllamaSetupPanelProps {
  /** Compact mode for SetupModal embedding */
  compact?: boolean;
  /** Called when Ollama is running and has at least one model */
  onReady?: (connectorName: string, firstModel: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function OllamaSetupPanel({ compact = false, onReady }: OllamaSetupPanelProps): React.ReactElement {
  const [state, setState] = useState<OllamaState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pullModelName, setPullModelName] = useState('');
  const [connectorCreated, setConnectorCreated] = useState(false);
  const [devMode, setDevMode] = useState(false);

  const loadState = useCallback(async () => {
    try {
      const s = await window.hosea.ollama.getState();
      setState(s);

      // Auto-fill recommended model in pull input — but only if not already installed
      if (!pullModelName && s.systemInfo.recommendedModel) {
        const alreadyInstalled = s.models.some((m) => m.name === s.systemInfo.recommendedModel || m.name.startsWith(s.systemInfo.recommendedModel.split(':')[0] + ':'));
        if (!alreadyInstalled) {
          setPullModelName(s.systemInfo.recommendedModel);
        }
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadState();
    window.hosea.app.getIsDev().then(setDevMode).catch(() => {});

    // Listen for push events
    window.hosea.ollama.onStateChanged((newState) => {
      setState(newState);
    });

    return () => {
      window.hosea.ollama.removeListeners();
    };
  }, [loadState]);

  // Notify parent when ready (running + has models + connector created)
  useEffect(() => {
    if (state?.status === 'running' && state.models.length > 0 && connectorCreated && onReady) {
      onReady('ollama-local', state.models[0].name);
    }
  }, [state?.status, state?.models.length, connectorCreated, onReady]);

  const handleDownload = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const result = await window.hosea.ollama.download();
      if (!result.success) {
        setError(result.error || 'Download failed');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleStart = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const result = await window.hosea.ollama.start();
      if (!result.success) {
        setError(result.error || 'Failed to start Ollama');
      } else {
        // Ensure the connector exists
        await ensureConnector();
        await loadState();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    setActionLoading(true);
    try {
      await window.hosea.ollama.stop();
      await loadState();
    } catch (err) {
      setError(String(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handlePullModel = async () => {
    if (!pullModelName.trim()) return;
    setError(null);
    try {
      const result = await window.hosea.ollama.pullModel(pullModelName.trim());
      if (!result.success) {
        setError(result.error || 'Failed to pull model');
      } else {
        // After first model pull, ensure connector exists
        await ensureConnector();
        await loadState();
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDeleteModel = async (name: string) => {
    try {
      await window.hosea.ollama.deleteModel(name);
      await loadState();
    } catch (err) {
      setError(String(err));
    }
  };

  const ensureConnector = async () => {
    if (connectorCreated) return;
    try {
      const result = await window.hosea.ollama.ensureConnector();
      if (result.success) {
        setConnectorCreated(true);
      }
    } catch {
      // Non-critical
    }
  };

  if (loading) {
    return (
      <div className="text-center py-4">
        <Spinner animation="border" size="sm" className="me-2" />
        Checking Ollama status...
      </div>
    );
  }

  if (!state) {
    return <Alert variant="danger">Failed to load Ollama status</Alert>;
  }

  return (
    <div>
      {/* Error display */}
      {(error || state.error) && (
        <Alert variant="danger" className="mb-3" dismissible onClose={() => setError(null)}>
          <AlertCircle size={16} className="me-2" />
          {error || state.error}
        </Alert>
      )}

      {/* Status: Not Installed */}
      {state.status === 'not_installed' && (
        <Card className="mb-3">
          <Card.Body className="text-center py-4">
            <Cpu size={40} className="text-muted mb-3" />
            <h5>Run AI Locally with Ollama</h5>
            <p className="text-muted mb-3">
              Install Ollama to run AI models on your computer. No API keys needed.
            </p>
            <Button
              variant="primary"
              size="lg"
              onClick={handleDownload}
              disabled={actionLoading}
            >
              {actionLoading ? (
                <><Spinner size="sm" className="me-2" />Installing...</>
              ) : (
                <><Download size={18} className="me-2" />Install Ollama</>
              )}
            </Button>
          </Card.Body>
        </Card>
      )}

      {/* Status: Downloading */}
      {state.status === 'downloading' && state.downloadProgress && (
        <Card className="mb-3">
          <Card.Body>
            <h6 className="mb-2">Installing Ollama...</h6>
            <ProgressBar
              now={state.downloadProgress.percent}
              label={`${state.downloadProgress.percent}%`}
              animated
              striped
            />
            <small className="text-muted mt-1 d-block">
              {formatSize(state.downloadProgress.downloaded)} / {formatSize(state.downloadProgress.total)}
            </small>
          </Card.Body>
        </Card>
      )}

      {/* Status: Installed but not running */}
      {state.status === 'installed' && (
        <Card className="mb-3">
          <Card.Body className="text-center py-4">
            <CheckCircle size={32} className="text-success mb-2" />
            <h6>Ollama is installed{state.isExternalInstance ? ' on your system' : ''}</h6>
            {state.isExternalInstance && state.externalBinaryPath && (
              <small className="text-muted d-block mb-2">
                Found at: {state.externalBinaryPath}
              </small>
            )}
            <Button
              variant="success"
              onClick={handleStart}
              disabled={actionLoading}
            >
              {actionLoading ? (
                <><Spinner size="sm" className="me-2" />Starting...</>
              ) : (
                <><Play size={16} className="me-2" />Start Ollama</>
              )}
            </Button>
          </Card.Body>
        </Card>
      )}

      {/* Status: Starting */}
      {state.status === 'starting' && (
        <Card className="mb-3">
          <Card.Body className="text-center py-4">
            <Spinner animation="border" className="mb-2" />
            <p className="mb-0">Starting Ollama...</p>
          </Card.Body>
        </Card>
      )}

      {/* Status: Running */}
      {state.status === 'running' && (
        <>
          <Card className="mb-3">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center">
                <div className="d-flex align-items-center gap-2">
                  <Badge bg="success" className="d-flex align-items-center gap-1">
                    <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'currentColor' }} />
                    Running
                  </Badge>
                  {state.isExternalInstance && (
                    <Badge bg="info">External Instance</Badge>
                  )}
                  <small className="text-muted">{state.version}</small>
                </div>
                <div className="d-flex gap-2">
                  <Button variant="outline-secondary" size="sm" onClick={loadState}>
                    <RefreshCw size={14} />
                  </Button>
                  {!state.isExternalInstance && (
                    <Button variant="outline-danger" size="sm" onClick={handleStop} disabled={actionLoading}>
                      <Square size={14} className="me-1" />Stop
                    </Button>
                  )}
                </div>
              </div>
            </Card.Body>
          </Card>

          {/* Installed Models */}
          <Card className="mb-3">
            <Card.Body>
              <h6 className="mb-2">Installed Models</h6>
              {state.models.length === 0 ? (
                <p className="text-muted small mb-0">
                  No models installed yet. Pull a model below to get started.
                </p>
              ) : (
                <Table size="sm" className="mb-0">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Size</th>
                      {!compact && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {state.models.map((model) => (
                      <tr key={model.name}>
                        <td><code>{model.name}</code></td>
                        <td className="text-muted">{formatSize(model.size)}</td>
                        {!compact && (
                          <td className="text-end">
                            <Button
                              variant="outline-danger"
                              size="sm"
                              onClick={() => handleDeleteModel(model.name)}
                            >
                              <Trash2 size={12} />
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>

          {/* Pull Model */}
          <Card className="mb-3">
            <Card.Body>
              <h6 className="mb-2">Pull Model</h6>
              {state.systemInfo && (() => {
                const rec = state.systemInfo.recommendedModel;
                const isInstalled = state.models.some((m) => m.name === rec || m.name.startsWith(rec.split(':')[0] + ':'));
                if (isInstalled) return null;
                return (
                  <Alert variant="info" className="py-2 mb-2">
                    <small>
                      <HardDrive size={14} className="me-1" />
                      <strong>Recommended: {rec}</strong>
                      {' \u2014 '}{state.systemInfo.recommendedModelReason}
                    </small>
                  </Alert>
                );
              })()}

              {state.pullProgress ? (
                <div>
                  <div className="d-flex justify-content-between mb-1">
                    <small>Pulling <strong>{state.pullProgress.model}</strong>...</small>
                    <small className="text-muted">{state.pullProgress.status}</small>
                  </div>
                  <ProgressBar
                    now={state.pullProgress.percent}
                    label={state.pullProgress.percent > 5 ? `${state.pullProgress.percent}%` : undefined}
                    animated
                    striped
                  />
                </div>
              ) : (
                <div className="d-flex gap-2">
                  <Form.Control
                    type="text"
                    placeholder="e.g., qwen3:8b"
                    value={pullModelName}
                    onChange={(e) => setPullModelName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handlePullModel()}
                  />
                  <Button
                    variant="primary"
                    onClick={handlePullModel}
                    disabled={!pullModelName.trim()}
                  >
                    Pull
                  </Button>
                </div>
              )}
            </Card.Body>
          </Card>
        </>
      )}

      {/* Status: Error */}
      {state.status === 'error' && (
        <Card className="mb-3">
          <Card.Body className="text-center py-4">
            <AlertCircle size={32} className="text-danger mb-2" />
            <h6>Something went wrong</h6>
            <p className="text-muted small mb-3">{state.error}</p>
            <Button variant="outline-primary" onClick={() => loadState()}>
              <RefreshCw size={16} className="me-2" />Retry
            </Button>
          </Card.Body>
        </Card>
      )}

      {/* Additional controls (non-compact only) */}
      {!compact && state.status !== 'not_installed' && state.status !== 'downloading' && (
        <Card>
          <Card.Body>
            <h6 className="mb-3">Preferences</h6>
            <Form.Check
              type="switch"
              id="ollama-autostart"
              label="Auto-start Ollama when hosea launches"
              checked={state.autoStart}
              onChange={(e) => window.hosea.ollama.setAutoStart(e.target.checked)}
            />
            {state.isExternalInstance && (
              <Alert variant="info" className="mt-3 mb-0 py-2">
                <small>
                  <ExternalLink size={14} className="me-1" />
                  Using externally installed Ollama. hosea manages the lifecycle but doesn't own the binary.
                </small>
              </Alert>
            )}
          </Card.Body>
        </Card>
      )}

      {/* System info (non-compact) */}
      {!compact && state.systemInfo && (
        <Card className="mt-3">
          <Card.Body>
            <h6 className="mb-2">System Info</h6>
            <div className="text-muted small">
              <div>RAM: {state.systemInfo.totalRAMGB}GB</div>
              <div>Platform: {state.systemInfo.platform} ({state.systemInfo.arch})</div>
            </div>
            {devMode && (
              <div className="mt-3 pt-3 border-top">
                <small className="text-muted d-block mb-2">Dev Tools</small>
                <Button
                  variant="outline-warning"
                  size="sm"
                  onClick={async () => {
                    await window.hosea.ollama.resetForTesting();
                    await loadState();
                  }}
                >
                  Reset Ollama State (Test Download Flow)
                </Button>
              </div>
            )}
          </Card.Body>
        </Card>
      )}
    </div>
  );
}
