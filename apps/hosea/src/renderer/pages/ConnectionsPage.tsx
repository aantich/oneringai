import React, { useState, useEffect, useCallback } from 'react';
import { Alert, Button, Spinner } from 'react-bootstrap';
import { Brain, Plug, ArrowUpRight, ShieldCheck, Server, Check } from 'lucide-react';
import { PageHeader } from '../components/layout';
import { useNavigation } from '../hooks/useNavigation';
import { Surface } from '../design-system/Primitives';

type OAuthApp = Awaited<ReturnType<typeof window.hosea.builtInOAuth.list>>[number];
export function ConnectionsPage(): React.ReactElement {
  const { navigate } = useNavigation();
  const [counts, setCounts] = useState({ models: 0, services: 0 });
  const [apps, setApps] = useState<Array<OAuthApp & { connected: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [models, services, available] = await Promise.all([
        window.hosea.connector.list(), window.hosea.universalConnector.list(), window.hosea.builtInOAuth.list(),
      ]);
      const statuses = await Promise.all(available.map(async app => ({ ...app, connected: (await window.hosea.builtInOAuth.getStatus(app.vendorId)).connected })));
      setCounts({ models: models.length, services: services.length });
      setApps(statuses);
    } catch { setError('Connections could not be loaded. Please try again.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const authorize = async (app: OAuthApp & { connected: boolean }) => {
    setBusy(app.vendorId); setError(null);
    try {
      const result = app.connected ? await window.hosea.builtInOAuth.disconnect(app.vendorId) : await window.hosea.builtInOAuth.authorize(app.vendorId);
      if (!result.success) throw new Error(result.error || 'Connection failed.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(null); }
  };
  return <div className="page">
    <PageHeader title="Connections" subtitle="Your models. Your tools. All in one workspace." />
    <div className="page__content"><div className="h-page-body">
      {error && <Alert variant="danger" dismissible onClose={() => setError(null)}>{error}</Alert>}
      {loading ? <Spinner animation="border" aria-label="Loading connections" /> : <>
        <div className="h-connection-summary">
          <Surface><div className="d-flex align-items-center justify-content-between"><Brain size={24} strokeWidth={1.5} /><span className="h-connection-count">{counts.models} configured</span></div>
            <h2>A model for every way you think.</h2><p>Connect OpenAI, Anthropic, and more with your own keys, or keep things local with Ollama.</p>
            <Button variant="primary" onClick={() => navigate('llm-connectors')}>Manage models <ArrowUpRight size={14} /></Button>
          </Surface>
          <Surface><div className="d-flex align-items-center justify-content-between"><Plug size={24} strokeWidth={1.5} /><span className="h-connection-count">{counts.services} configured</span></div>
            <h2>Give your agents a little reach.</h2><p>Bring in the services you use every day. Choose what each agent can access and do.</p>
            <Button variant="outline-secondary" onClick={() => navigate('connector-catalog')}>Browse services <ArrowUpRight size={14} /></Button>
          </Surface>
        </div>
        {apps.length > 0 && <><div className="h-section-heading"><div><h2>Quick connections</h2><p>Use your configured OAuth apps to connect securely.</p></div></div>
          <div className="h-action-grid">{apps.map(app => <Surface className="p-4" key={app.vendorId}><h3 className="h6">{app.displayName}</h3><Button size="sm" variant="outline-secondary" disabled={busy !== null} onClick={() => void authorize(app)}>{busy === app.vendorId ? <Spinner size="sm" /> : app.connected ? <><Check size={14} /> Disconnect</> : 'Connect'}</Button></Surface>)}</div>
        </>}
        <div className="h-section-heading"><div><h2>Make it work for you</h2><p>Fine-tune how your workspace connects to the world.</p></div></div>
        <div className="d-flex gap-2 flex-wrap"><Button variant="outline-secondary" onClick={() => navigate('universal-connectors')}><Plug size={15} />Service connectors</Button><Button variant="outline-secondary" onClick={() => navigate('mcp-servers')}><Server size={15} />MCP servers</Button><Button variant="outline-secondary" onClick={() => navigate('settings')}><Brain size={15} />Local AI & settings</Button></div>
        <div className="h-info-note"><ShieldCheck size={18} /><span>Connections are configured on this device. Your agents use only the models and tools you assign to them. You can review permissions before a tool runs.</span></div>
      </>}
    </div></div>
  </div>;
}
