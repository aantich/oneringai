/**
 * AgentsPage — orchestrates agent list data and composes agent UI components.
 * Data fetching lives here; all rendering is delegated to focused sub-components.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { useNavigation } from '../../hooks/useNavigation.js';
import { useTabContext } from '../../hooks/useTabContext.js';
import { useConnectorVersion } from '../../App.js';
import { AgentStatsBar } from './AgentStatsBar.js';
import { AgentToolbar } from './AgentToolbar.js';
import { AgentCard } from './AgentCard.js';
import type { AgentListItem, ConnectorListItem, AgentFilters } from './agentTypes.js';
import { computeStats, filterAgents } from './agentUtils.js';
import '../../styles/agents.css';

export function AgentsPage(): React.ReactElement {
  const { navigate } = useNavigation();
  const { createTab } = useTabContext();
  const connectorVersion = useConnectorVersion();

  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [connectors, setConnectors] = useState<ConnectorListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<AgentFilters>({ query: '', activeOnly: false });

  const loadData = useCallback(async () => {
    try {
      const [agentList, connectorList] = await Promise.all([
        window.hosea.agentConfig.list(),
        window.hosea.connector.list(),
      ]);
      setAgents(agentList as AgentListItem[]);
      setConnectors(connectorList as ConnectorListItem[]);
    } catch (err) {
      console.error('Failed to load agents:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData, connectorVersion]);

  // Derived sets — memoised with useMemo for perf
  const availableConnectors = React.useMemo(
    () => new Set(connectors.map((c) => c.name)),
    [connectors],
  );
  const ewConnectors = React.useMemo(
    () => new Set(connectors.filter((c) => c.source === 'everworker').map((c) => c.name)),
    [connectors],
  );

  const stats = React.useMemo(() => computeStats(agents), [agents]);
  const visibleAgents = React.useMemo(() => filterAgents(agents, filters), [agents, filters]);
  const activeCount = React.useMemo(() => agents.filter((a) => a.isActive).length, [agents]);

  // Handlers
  const handleCreateAgent = () => navigate('agent-editor', { mode: 'create' });

  const handleChat = useCallback(async (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    const tabId = await createTab(agentId, agent?.name ?? 'Assistant');
    if (tabId) navigate('chat');
  }, [agents, createTab, navigate]);

  const handleEdit = (agentId: string) => navigate('agent-editor', { mode: 'edit', id: agentId });
  const handleFixConnector = () => navigate('llm-connectors');

  if (loading) {
    return (
      <div className="page agents-page">
        <div className="page__header">
          <div className="page__header-left">
            <h1 className="page__title">Agents</h1>
            <p className="page__subtitle">Create and manage your AI agents</p>
          </div>
        </div>
        <div className="page__content page__content--centered">
          <div className="spinner-border text-primary" role="status" />
        </div>
      </div>
    );
  }

  return (
    <div className="page agents-page">
      {/* Page header */}
      <div className="page__header">
        <div className="page__header-left">
          <div>
            <h1 className="page__title">Agents</h1>
            <p className="page__subtitle">Create and manage your AI agents</p>
          </div>
        </div>
        <div className="page__header-right">
          <button className="btn btn-primary" onClick={handleCreateAgent}>
            <Plus size={14} />
            New Agent
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <AgentStatsBar stats={stats} />

      {/* Toolbar — only when there are agents */}
      {agents.length > 0 && (
        <AgentToolbar
          filters={filters}
          activeCount={activeCount}
          totalVisible={visibleAgents.length}
          onFiltersChange={setFilters}
        />
      )}

      {/* Content */}
      <div className="page__content">
        {agents.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">
              <Plus size={32} />
            </div>
            <h3 className="empty-state__title">No agents yet</h3>
            <p className="empty-state__description">
              Create your first AI agent. Configure model, tools, and memory to match your workflow.
            </p>
            <button className="btn btn-primary" onClick={handleCreateAgent}>
              <Plus size={14} />
              Create Agent
            </button>
          </div>
        ) : (
          <div className="agents-grid">
            {visibleAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                isConnectorAvailable={availableConnectors.has(agent.connector)}
                isEwConnector={ewConnectors.has(agent.connector)}
                onChat={handleChat}
                onEdit={handleEdit}
                onFixConnector={handleFixConnector}
              />
            ))}

            {/* New agent dashed card */}
            <div
              className="agent-card agent-card--new"
              onClick={handleCreateAgent}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleCreateAgent();
                }
              }}
              aria-label="Create new agent"
            >
              <div className="agent-card__new-inner">
                <div className="agent-card__new-icon"><Plus size={18} /></div>
                <div className="agent-card__new-label">Create new agent</div>
                <div className="agent-card__new-sub">Configure model, tools & memory</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
