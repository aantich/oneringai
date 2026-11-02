import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Tabs, Tab, ListGroup, Badge } from 'react-bootstrap';

interface SettingsModalProps {
  show: boolean;
  onHide: () => void;
}

interface Config {
  activeConnector: string | null;
  activeModel: string | null;
  ui: {
    theme: 'light' | 'dark' | 'system';
    fontSize: number;
    streamResponses: boolean;
  };
}

interface ToolInfo {
  name: string;
  enabled: boolean;
  description: string;
}

export function SettingsModal({
  show,
  onHide,
}: SettingsModalProps): React.ReactElement {
  const [config, setConfig] = useState<Config | null>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [activeTab, setActiveTab] = useState('general');
  const [appVersion, setAppVersion] = useState('...');

  useEffect(() => {
    if (show) {
      loadSettings();
      window.hosea.app.getVersion().then(v => setAppVersion(v));
    }
  }, [show]);

  const loadSettings = async () => {
    const [cfg, toolList] = await Promise.all([
      window.hosea.config.get() as Promise<Config>,
      window.hosea.tool.list(),
    ]);
    setConfig(cfg);
    setTools(toolList);
  };

  const handleConfigChange = async (key: string, value: unknown) => {
    await window.hosea.config.set(key, value);
    setConfig((prev) => {
      if (!prev) return prev;
      const newConfig = { ...prev };
      const keys = key.split('.');
      let obj: Record<string, unknown> = newConfig as unknown as Record<string, unknown>;
      for (let i = 0; i < keys.length - 1; i++) {
        obj = obj[keys[i]] as Record<string, unknown>;
      }
      obj[keys[keys.length - 1]] = value;
      return newConfig;
    });
  };

  const handleToolToggle = async (toolName: string, enabled: boolean) => {
    await window.hosea.tool.toggle(toolName, enabled);
    setTools((prev) =>
      prev.map((t) => (t.name === toolName ? { ...t, enabled } : t))
    );
  };

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Settings</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Tabs activeKey={activeTab} onSelect={(k) => setActiveTab(k || 'general')}>
          <Tab eventKey="general" title="General">
            <div className="py-3">
              {config && (
                <>
                  <Form.Group className="mb-3">
                    <Form.Label>Theme</Form.Label>
                    <Form.Select
                      value={config.ui.theme}
                      onChange={(e) => handleConfigChange('ui.theme', e.target.value)}
                    >
                      <option value="system">System</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </Form.Select>
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>Font Size: {config.ui.fontSize}px</Form.Label>
                    <Form.Range
                      min={12}
                      max={20}
                      value={config.ui.fontSize}
                      onChange={(e) =>
                        handleConfigChange('ui.fontSize', parseInt(e.target.value))
                      }
                    />
                  </Form.Group>

                  <Form.Check
                    type="switch"
                    id="stream-responses"
                    label="Stream responses"
                    checked={config.ui.streamResponses}
                    onChange={(e) =>
                      handleConfigChange('ui.streamResponses', e.target.checked)
                    }
                  />
                </>
              )}
            </div>
          </Tab>

          <Tab eventKey="tools" title="Tools">
            <div className="py-3">
              {tools.length === 0 ? (
                <p className="text-muted">No tools available. Connect to an agent first.</p>
              ) : (
                <ListGroup>
                  {tools.map((tool) => (
                    <ListGroup.Item
                      key={tool.name}
                      className="d-flex justify-content-between align-items-center"
                    >
                      <div>
                        <strong>{tool.name}</strong>
                        <br />
                        <small className="text-muted">{tool.description}</small>
                      </div>
                      <Form.Check
                        type="switch"
                        checked={tool.enabled}
                        onChange={(e) => handleToolToggle(tool.name, e.target.checked)}
                      />
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              )}
            </div>
          </Tab>

          <Tab eventKey="about" title="About">
            <div className="py-3 text-center">
              <h4>hosea</h4>
              <p className="text-muted">AI Agent Desktop Application by hosea</p>
              <p>Version {appVersion}</p>
              <hr />
              <p className="small text-muted">
                Built with Electron, React, and oneringai
              </p>
              <Badge bg="info">OneRing AI</Badge>
            </div>
          </Tab>
        </Tabs>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
