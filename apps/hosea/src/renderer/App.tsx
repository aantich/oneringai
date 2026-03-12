/**
 * Everworker Desktop Main App Component
 */

import React, { useState, useCallback, useEffect, useContext, createContext, Component, ErrorInfo, ReactNode } from 'react';
import { Spinner, Alert, Button } from 'react-bootstrap';
import { Sidebar } from './components/layout';
import {
  ChatPage,
  HistoryPage,
  AgentsPage,
  AgentEditorPage,
  ConnectionsPage,
  LLMConnectorsPage,
  UniversalConnectorsPage,
  ConnectorCatalogPage,
  ConnectorCreatePage,
  ToolConnectorsPage,
  MCPServersPage,
  MultimediaStudioPage,
  RoutinesPage,
  RoutineBuilderPage,
  InternalsPage,
  SettingsPage,
} from './pages';
import { SetupModal } from './components/modals/SetupModal';
import { LicenseAcceptanceModal } from './components/modals/LicenseAcceptanceModal';
import { WhatsNewModal } from './components/modals/WhatsNewModal';
import { whatsNewEntries } from './whatsnew';
import { UpdateNotification } from './components/UpdateNotification';
import {
  NavigationContext,
  useNavigationState,
} from './hooks/useNavigation';
import { TabProvider } from './hooks/useTabContext';

// Default models for each vendor
const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4.1',
  anthropic: 'claude-sonnet-4-20250514',
  google: 'gemini-2.5-pro',
  groq: 'llama-3.3-70b-versatile',
  together: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  mistral: 'mistral-large-latest',
  deepseek: 'deepseek-chat',
};

// ============ Connector Version Context ============
// Bumped when EW profile switch causes connector changes, so pages auto-refresh
export const ConnectorVersionContext = createContext(0);
export function useConnectorVersion(): number {
  return useContext(ConnectorVersionContext);
}

// ============ Error Boundary ============
// Catches React render errors and prevents app from going completely blank

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    this.setState({ errorInfo });
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleDismiss = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="app-error-boundary" style={{
          padding: '40px',
          maxWidth: '800px',
          margin: '0 auto',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          <Alert variant="danger">
            <Alert.Heading>Something went wrong</Alert.Heading>
            <p>
              Everworker Desktop encountered an unexpected error. This is usually caused by a
              temporary issue with the AI service or network connection.
            </p>
            <hr />
            <div className="d-flex gap-2">
              <Button variant="primary" onClick={this.handleReload}>
                Reload App
              </Button>
              <Button variant="outline-secondary" onClick={this.handleDismiss}>
                Try to Continue
              </Button>
            </div>
            {this.state.error && (
              <details className="mt-3" style={{ fontSize: '12px', fontFamily: 'monospace' }}>
                <summary style={{ cursor: 'pointer' }}>Technical Details</summary>
                <pre style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  background: '#f8f9fa',
                  padding: '10px',
                  borderRadius: '4px',
                  marginTop: '10px'
                }}>
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
          </Alert>
        </div>
      );
    }

    return this.props.children;
  }
}

function AppContent(): React.ReactElement {
  const navigation = useNavigationState();
  const [showSetup, setShowSetup] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [defaultAgentConfig, setDefaultAgentConfig] = useState<{ id: string; name: string } | null>(null);
  const initStarted = React.useRef(false);
  const [connectorVersion, setConnectorVersion] = useState(0);
  const [serviceReady, setServiceReady] = useState(false);
  const [licenseAccepted, setLicenseAccepted] = useState<boolean | null>(null); // null = loading
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [whatsNewChecked, setWhatsNewChecked] = useState(false);

  // Check license acceptance on mount
  useEffect(() => {
    window.hosea.license.getStatus().then((status) => {
      setLicenseAccepted(status.accepted);
    });
  }, []);

  // Check What's New after license is accepted
  useEffect(() => {
    if (!licenseAccepted) return;

    const checkWhatsNew = async () => {
      const latestEntry = whatsNewEntries[0];
      if (!latestEntry) {
        setWhatsNewChecked(true);
        return;
      }
      try {
        const dismissed = await window.hosea.whatsnew.getLastSeen();
        console.log('[WhatsNew] latest entry:', latestEntry.version, 'dismissed:', dismissed);
        if (dismissed !== latestEntry.version) {
          setShowWhatsNew(true);
        }
      } catch (error) {
        // IPC not available (preload not rebuilt?) — show anyway
        console.warn('[WhatsNew] IPC error, showing popup anyway:', error);
        setShowWhatsNew(true);
      }
      setWhatsNewChecked(true);
    };

    checkWhatsNew();
  }, [licenseAccepted]);

  // Listen for service readiness (non-blocking startup)
  useEffect(() => {
    window.hosea.service.isReady().then((ready) => {
      if (ready) setServiceReady(true);
    });
    window.hosea.service.onReady(() => setServiceReady(true));
    return () => {
      window.hosea.service.removeReadyListener();
    };
  }, []);

  // Listen for connector changes from EW profile switches
  useEffect(() => {
    window.hosea.everworker.onConnectorsChanged(() => {
      setConnectorVersion(prev => prev + 1);
    });
    return () => {
      window.hosea.everworker.removeConnectorsChangedListener();
    };
  }, []);

  // App initialization flow (waits for service to be ready):
  // 1. Check for active agent -> activate it
  // 2. Check for any agents -> activate the most recent one
  // 3. Check for connectors -> auto-create a default agent
  // 4. No connectors -> show setup modal
  useEffect(() => {
    // Wait for heavy initialization to complete before running app init
    if (!serviceReady) return;

    const initializeApp = async () => {
      // Prevent double execution (React StrictMode in dev)
      if (initStarted.current) return;
      initStarted.current = true;

      try {
        // Step 1: Check if there's already an active agent
        const activeAgent = await window.hosea.agentConfig.getActive();
        if (activeAgent) {
          // Ensure it's initialized in the runtime
          const status = await window.hosea.agent.status();
          if (!status.initialized) {
            await window.hosea.agentConfig.setActive(activeAgent.id);
          }
          // Store the default agent config for TabProvider
          setDefaultAgentConfig({ id: activeAgent.id, name: activeAgent.name });
          setIsInitializing(false);
          return;
        }

        // Step 2: Check for any existing agents
        const agents = await window.hosea.agentConfig.list();
        if (agents.length > 0) {
          // Activate the most recently used/updated agent
          const mostRecent = agents[0]; // Already sorted by updatedAt desc
          await window.hosea.agentConfig.setActive(mostRecent.id);
          // Store the default agent config for TabProvider
          setDefaultAgentConfig({ id: mostRecent.id, name: mostRecent.name });
          setIsInitializing(false);
          return;
        }

        // Step 3: Check for connectors to auto-create default agent
        const connectors = await window.hosea.connector.list();
        if (connectors.length > 0) {
          // Auto-create a default agent with the first connector
          const firstConnector = connectors[0];
          const defaultModel = DEFAULT_MODELS[firstConnector.vendor] || 'gpt-4.1';

          const result = await window.hosea.agentConfig.createDefault(
            firstConnector.name,
            defaultModel
          );

          if (!result.success) {
            console.error('Failed to create default agent:', result.error);
          } else {
            // Fetch the newly created agent to get its config
            const newActiveAgent = await window.hosea.agentConfig.getActive();
            if (newActiveAgent) {
              setDefaultAgentConfig({ id: newActiveAgent.id, name: newActiveAgent.name });
            }
          }

          setIsInitializing(false);
          return;
        }

        // Step 4: No connectors - show setup modal
        setShowSetup(true);
        setIsInitializing(false);
      } catch (error) {
        console.error('Error initializing app:', error);
        setIsInitializing(false);
      }
    };

    initializeApp();
  }, [serviceReady]);

  // Called when setup modal completes (creates connector + default agent)
  const handleSetupComplete = useCallback(async () => {
    setShowSetup(false);
    // The setup modal now creates the agent, so we just need to refresh
    let activeAgent = await window.hosea.agentConfig.getActive();
    if (!activeAgent) {
      // Fallback: try to activate any available agent
      const agents = await window.hosea.agentConfig.list();
      if (agents.length > 0) {
        await window.hosea.agentConfig.setActive(agents[0].id);
        activeAgent = agents[0];
      }
    }
    // Update the default agent config for TabProvider
    if (activeAgent) {
      setDefaultAgentConfig({ id: activeAgent.id, name: activeAgent.name });
    }
  }, []);

  const renderPage = () => {
    switch (navigation.state.currentPage) {
      case 'chat':
        return <ChatPage />;
      case 'history':
        return <HistoryPage />;
      case 'agents':
        return <AgentsPage />;
      case 'agent-editor':
        return <AgentEditorPage />;
      case 'connections':
        return <ConnectionsPage />;
      case 'llm-connectors':
        return <LLMConnectorsPage />;
      case 'universal-connectors':
        return <UniversalConnectorsPage />;
      case 'connector-catalog':
        return <ConnectorCatalogPage />;
      case 'connector-create':
        return <ConnectorCreatePage />;
      case 'tool-connectors':
        return <ToolConnectorsPage />;
      case 'mcp-servers':
        return <MCPServersPage />;
      case 'multimedia-studio':
        return <MultimediaStudioPage />;
      case 'routines':
        return <RoutinesPage />;
      case 'routine-builder':
        return <RoutineBuilderPage />;
      case 'internals':
        return <InternalsPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <ChatPage />;
    }
  };

  // Handle What's New close — only persist dismissal if user ticked the checkbox
  const handleWhatsNewClose = useCallback(async (dontShowAgain: boolean) => {
    setShowWhatsNew(false);
    if (dontShowAgain) {
      const latestEntry = whatsNewEntries[0];
      if (latestEntry) {
        try {
          await window.hosea.whatsnew.markSeen(latestEntry.version);
        } catch (error) {
          console.error('Error saving What\'s New state:', error);
        }
      }
    }
  }, []);

  // Handle license acceptance
  const handleLicenseAccept = useCallback(async () => {
    await window.hosea.license.accept();
    setLicenseAccepted(true);
  }, []);

  const handleLicenseDecline = useCallback(() => {
    // Close the app if license is declined
    window.close();
  }, []);

  // Show license modal if not yet accepted (blocks everything else)
  if (licenseAccepted === null) {
    return (
      <div className="app-loading">
        <Spinner animation="border" variant="primary" />
        <p className="mt-3 text-muted">Starting Everworker Desktop...</p>
      </div>
    );
  }

  if (!licenseAccepted) {
    return (
      <LicenseAcceptanceModal
        show={true}
        onAccept={handleLicenseAccept}
        onDecline={handleLicenseDecline}
      />
    );
  }

  // Show loading spinner while initializing (but allow What's New modal to overlay)
  if (isInitializing) {
    return (
      <>
        <div className="app-loading">
          <Spinner animation="border" variant="primary" />
          <p className="mt-3 text-muted">Starting Everworker Desktop...</p>
        </div>
        <WhatsNewModal show={showWhatsNew} onClose={handleWhatsNewClose} />
      </>
    );
  }

  return (
    <ConnectorVersionContext.Provider value={connectorVersion}>
      <NavigationContext.Provider value={navigation}>
        <TabProvider
          defaultAgentConfigId={defaultAgentConfig?.id}
          defaultAgentName={defaultAgentConfig?.name}
        >
          <div className="app-layout">
            <Sidebar />
            <main className="app-main">
              {/* macOS drag region for window dragging */}
              <div className="app-main__drag-region" />
              {renderPage()}
            </main>
          </div>

          <SetupModal
            show={showSetup}
            onHide={() => setShowSetup(false)}
            onComplete={handleSetupComplete}
          />

          {/* What's New modal (non-blocking overlay) */}
          <WhatsNewModal show={showWhatsNew} onClose={handleWhatsNewClose} />

          {/* Auto-update notification */}
          <UpdateNotification />
        </TabProvider>
      </NavigationContext.Provider>
    </ConnectorVersionContext.Provider>
  );
}

export function App(): React.ReactElement {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
