import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Alert, Spinner } from 'react-bootstrap';
import { Key, Cpu, MessageCircle } from 'lucide-react';
import { OllamaSetupPanel } from '../ollama/OllamaSetupPanel.js';
import { ChatGPTConnection } from '../connectors/ChatGPTConnection.js';

interface SetupModalProps {
  show: boolean;
  onHide: () => void;
  onComplete: () => void;
}

interface ConnectorConfig {
  name: string;
  vendor: string;
  authMode?: 'api-key' | 'chatgpt-plan';
  connected?: boolean;
  source?: 'local' | 'backend' | 'built-in';
  createdAt: number;
}

interface ModelGroup {
  vendor: string;
  models: Array<{ id: string; name: string; contextWindow: number }>;
}

// Default models for each vendor
const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4.1',
  anthropic: 'claude-sonnet-4-20250514',
  google: 'gemini-2.5-pro',
  groq: 'llama-3.3-70b-versatile',
  together: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  mistral: 'mistral-large-latest',
  deepseek: 'deepseek-v4-flash',
};

export function SetupModal({
  show,
  onHide,
  onComplete,
}: SetupModalProps): React.ReactElement {
  const [step, setStep] = useState<'choice' | 'connector' | 'model' | 'new-connector' | 'local-ai' | 'chatgpt'>('connector');
  const [connectors, setConnectors] = useState<ConnectorConfig[]>([]);
  const [models, setModels] = useState<ModelGroup[]>([]);
  const [selectedConnector, setSelectedConnector] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planModels, setPlanModels] = useState<ModelGroup['models']>([]);

  // New connector form
  const [newConnectorName, setNewConnectorName] = useState('');
  const [newConnectorVendor, setNewConnectorVendor] = useState('openai');
  const [newConnectorApiKey, setNewConnectorApiKey] = useState('');

  // Load data on show
  useEffect(() => {
    if (show) {
      loadData();
    }
  }, [show]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [connectorList, modelList] = await Promise.all([
        window.hosea.connector.list(),
        window.hosea.model.list(),
      ]);
      setConnectors(connectorList);
      setModels(modelList);

      if (connectorList.length === 0) {
        // No connectors — offer ChatGPT, API keys and local models.
        setStep('choice');
      } else {
        setStep('connector');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const selectModels = async (connector: ConnectorConfig) => {
    setLoading(true);
    setError(null);
    setSelectedModel('');
    setPlanModels([]);
    try {
      if (connector.authMode === 'chatgpt-plan') {
        const result = await window.hosea.connector.fetchModels('openai', undefined, undefined, connector.name);
        if (!result.success || !result.models?.length) throw new Error(result.error || 'No models are available for this ChatGPT account.');
        // The account catalog determines access; the registry supplies model metadata.
        const registered = new Map(
          (models.find(group => group.vendor === connector.vendor)?.models ?? []).map(model => [model.id, model])
        );
        setPlanModels(result.models.map(id => registered.get(id) ?? { id, name: id, contextWindow: 0 }));
        setSelectedModel(result.models[0]);
      } else {
        const defaultModel = DEFAULT_MODELS[connector.vendor];
        setSelectedModel(defaultModel ?? '');
      }
      setStep('model');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  };

  const handleConnectorSelect = async () => {
    const connector = connectors.find(c => c.name === selectedConnector);
    if (connector) await selectModels(connector);
  };

  const refreshChatGPT = async () => {
    try {
      const list = await window.hosea.connector.list();
      setConnectors(list);
      setSelectedConnector(list.find(c => c.authMode === 'chatgpt-plan' && c.connected)?.name ?? '');
      setError(null);
    } catch { setError('The ChatGPT connection could not be loaded. Please try again.'); }
  };

  const handleAddConnector = async () => {
    if (!newConnectorName || !newConnectorApiKey) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await window.hosea.connector.add({
        name: newConnectorName,
        vendor: newConnectorVendor,
        auth: {
          type: 'api_key',
          apiKey: newConnectorApiKey,
        },
      });

      if (result.success) {
        setSelectedConnector(newConnectorName);
        await loadData();
        // OpenAI connections still use the selected ChatGPT plan until billing is explicitly changed.
        const list = await window.hosea.connector.list();
        const connector = list.find(c => c.name === newConnectorName);
        if (!connector) throw new Error('The new connector could not be loaded.');
        await selectModels(connector);
      } else {
        setError(result.error || 'Failed to add connector');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  // Complete setup: create default agent with selected connector + model
  const handleComplete = async () => {
    if (!selectedConnector || !selectedModel) {
      setError('Please select a connector and model');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Create a default agent with the selected connector and model
      const result = await window.hosea.agentConfig.createDefault(
        selectedConnector,
        selectedModel
      );

      if (result.success) {
        onComplete();
      } else {
        setError(result.error || 'Failed to create agent');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  // Handle Ollama ready: connector + model are set up
  const handleOllamaReady = async (connectorName: string, firstModel: string) => {
    setSelectedConnector(connectorName);
    setSelectedModel(firstModel);

    setLoading(true);
    setError(null);

    try {
      const result = await window.hosea.agentConfig.createDefault(connectorName, firstModel);
      if (result.success) {
        onComplete();
      } else {
        setError(result.error || 'Failed to create agent');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const getModelsForVendor = () => {
    const connector = connectors.find((c) => c.name === selectedConnector);
    if (!connector) return [];
    if (connector.authMode === 'chatgpt-plan') return planModels;
    const vendorModels = models.find(
      (m) => m.vendor.toLowerCase() === connector.vendor.toLowerCase()
    );
    return vendorModels?.models || [];
  };

  // ============ Choice Screen (no connectors) ============
  const renderChoiceStep = () => (
    <>
      <Modal.Body>
        <p className="text-muted mb-4">Choose how you'd like to use AI with hosea:</p>

        <div className="d-grid gap-3">
          <Button variant="outline-primary" className="text-start p-3" onClick={() => { setStep('chatgpt'); void refreshChatGPT(); }}>
            <div className="d-flex align-items-center gap-3">
              <MessageCircle size={24} />
              <div><strong>Continue with ChatGPT</strong><div className="text-muted small">Sign in with your eligible ChatGPT plan. No API key needed.</div></div>
            </div>
          </Button>
          <Button
            variant="outline-primary"
            className="text-start p-3"
            onClick={() => setStep('new-connector')}
          >
            <div className="d-flex align-items-center gap-3">
              <Key size={24} />
              <div>
                <strong>Add API Key</strong>
                <div className="text-muted small">
                  Connect to OpenAI, Anthropic, Google, or other cloud providers
                </div>
              </div>
            </div>
          </Button>

          <Button
            variant="outline-success"
            className="text-start p-3"
            onClick={() => setStep('local-ai')}
          >
            <div className="d-flex align-items-center gap-3">
              <Cpu size={24} />
              <div>
                <strong>Run Locally with Ollama</strong>
                <div className="text-muted small">
                  Free, private, no API keys needed. Runs on your computer.
                </div>
              </div>
            </div>
          </Button>
        </div>
      </Modal.Body>
    </>
  );

  const renderChatGPTStep = () => <>
    <Modal.Body>
      <ChatGPTConnection showWelcome={false} onChanged={() => void refreshChatGPT()} />
      {error && <Alert variant="danger">{error}</Alert>}
    </Modal.Body>
    <Modal.Footer>
      <Button variant="outline-secondary" disabled={loading} onClick={() => setStep(connectors.length ? 'connector' : 'choice')}>Back</Button>
      <Button disabled={!selectedConnector || loading} onClick={() => void handleConnectorSelect()}>{loading ? <Spinner size="sm" /> : 'Choose model'}</Button>
    </Modal.Footer>
  </>;

  // ============ Local AI Setup ============
  const renderLocalAIStep = () => (
    <>
      <Modal.Body>
        <OllamaSetupPanel compact onReady={handleOllamaReady} />
        {error && <Alert variant="danger" className="mt-3">{error}</Alert>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={() => setStep('choice')}>
          Back
        </Button>
      </Modal.Footer>
    </>
  );

  const renderConnectorStep = () => (
    <>
      <Modal.Body>
        <Form.Group className="mb-3">
          <Form.Label>Select a connector</Form.Label>
          <Form.Select
            value={selectedConnector}
            onChange={(e) => { setSelectedConnector(e.target.value); setError(null); }}
          >
            <option value="">Choose...</option>
            {connectors.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.vendor}){c.source === 'backend' ? ' [backend]' : c.source === 'local' ? ' [Local]' : ''}
              </option>
            ))}
          </Form.Select>
        </Form.Group>

        <div className="text-center text-muted my-3">or</div>

        <Button
          variant="outline-secondary"
          className="w-100"
          onClick={() => setStep('new-connector')}
        >
          Add New Connector
        </Button>
        <Button variant="outline-secondary" className="w-100 mt-2" onClick={() => { setStep('chatgpt'); void refreshChatGPT(); }}>Continue with ChatGPT</Button>
        {error && <Alert variant="danger" className="mt-3">{error}</Alert>}
      </Modal.Body>
      <Modal.Footer>
        <Button
          variant="primary"
          onClick={() => void handleConnectorSelect()}
          disabled={!selectedConnector || loading}
        >
          Next
        </Button>
      </Modal.Footer>
    </>
  );

  const renderNewConnectorStep = () => (
    <>
      <Modal.Body>
        <Form.Group className="mb-3">
          <Form.Label>Connector Name</Form.Label>
          <Form.Control
            type="text"
            value={newConnectorName}
            onChange={(e) => setNewConnectorName(e.target.value)}
            placeholder="e.g., my-openai"
          />
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>Vendor</Form.Label>
          <Form.Select
            value={newConnectorVendor}
            onChange={(e) => setNewConnectorVendor(e.target.value)}
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="google">Google</option>
            <option value="groq">Groq</option>
            <option value="together">Together</option>
            <option value="mistral">Mistral</option>
            <option value="deepseek">DeepSeek</option>
          </Form.Select>
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>API Key</Form.Label>
          <Form.Control
            type="password"
            value={newConnectorApiKey}
            onChange={(e) => setNewConnectorApiKey(e.target.value)}
            placeholder="sk-..."
          />
        </Form.Group>

        {error && <Alert variant="danger">{error}</Alert>}
      </Modal.Body>
      <Modal.Footer>
        {connectors.length > 0 ? (
          <Button variant="outline-secondary" onClick={() => setStep('connector')}>
            Back
          </Button>
        ) : (
          <Button variant="outline-secondary" onClick={() => setStep('choice')}>
            Back
          </Button>
        )}
        <Button variant="primary" onClick={handleAddConnector} disabled={loading}>
          {loading ? <Spinner size="sm" /> : 'Add Connector'}
        </Button>
      </Modal.Footer>
    </>
  );

  const renderModelStep = () => {
    const availableModels = getModelsForVendor();

    return (
      <>
        <Modal.Body>
          <Alert variant="info">
            Using connector: <strong>{selectedConnector}</strong>
          </Alert>

          <Form.Group className="mb-3">
            <Form.Label>Select a model</Form.Label>
            <Form.Select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              <option value="">Choose...</option>
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.contextWindow > 0 ? `${(m.contextWindow / 1000).toFixed(0)}K context` : 'context limit unknown'})
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          <p className="text-muted small">
            This will create a default agent with your selected connector and model.
            You can customize it later from the Agents page.
          </p>

          {error && <Alert variant="danger">{error}</Alert>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setStep('connector')}>
            Back
          </Button>
          <Button
            variant="primary"
            onClick={handleComplete}
            disabled={!selectedModel || loading}
          >
            {loading ? <Spinner size="sm" /> : 'Get Started'}
          </Button>
        </Modal.Footer>
      </>
    );
  };

  const getTitle = () => {
    switch (step) {
      case 'choice': return 'Make yourself at home.';
      case 'connector': return 'Select Connector';
      case 'new-connector': return 'Add Connector';
      case 'model': return 'Select Model';
      case 'local-ai': return 'Set Up Local AI';
      case 'chatgpt': return 'Connect ChatGPT';
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered backdrop="static" size={step === 'local-ai' || step === 'chatgpt' ? 'lg' : undefined}>
      <Modal.Header closeButton>
        <Modal.Title>{getTitle()}</Modal.Title>
      </Modal.Header>

      {loading && step === 'connector' ? (
        <Modal.Body className="text-center py-5">
          <Spinner animation="border" />
          <p className="mt-2">Loading...</p>
        </Modal.Body>
      ) : (
        <>
          {step === 'choice' && renderChoiceStep()}
          {step === 'chatgpt' && renderChatGPTStep()}
          {step === 'local-ai' && renderLocalAIStep()}
          {step === 'connector' && renderConnectorStep()}
          {step === 'new-connector' && renderNewConnectorStep()}
          {step === 'model' && renderModelStep()}
        </>
      )}
      {step === 'choice' && <Modal.Footer><Button variant="link" onClick={onHide}>Explore the workspace first</Button></Modal.Footer>}
    </Modal>
  );
}
