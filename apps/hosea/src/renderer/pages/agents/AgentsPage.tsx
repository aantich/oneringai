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
import { computeStats, filterAgents, sortAgents } from './agentUtils.js';
import '../../styles/agents.css';

export function AgentsPage(): React.ReactElement {
  const { navigate } = useNavigation();
  const { createTab } = useTabContext();
  const connectorVersion = useConnectorVersion();

  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [connectors, setConnectors] = useState<ConnectorListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<AgentFilters>({ query: '', activeOnly: false, showArchived: false });

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
  const filteredAgents = React.useMemo(() => filterAgents(agents, filters), [agents, filters]);
  const visibleAgents = React.useMemo(() => sortAgents(filteredAgents), [filteredAgents]);
  const activeCount = React.useMemo(() => agents.filter((a) => a.isActive && !a.isArchived).length, [agents]);
  const archivedCount = React.useMemo(() => agents.filter((a) => a.isArchived).length, [agents]);

  // Handlers
  const handleCreateAgent = () => navigate('agent-editor', { mode: 'create' });

  const handleChat = useCallback(async (agentId: string) => {
    try {
      const agent = agents.find((a) => a.id === agentId);
      const tabId = await createTab(agentId, agent?.name ?? 'Assistant');
      if (tabId) {
        navigate('chat');
      } else {
        console.error('[AgentsPage] createTab returned null for agentId:', agentId);
      }
    } catch (err) {
      console.error('[AgentsPage] handleChat error:', err);
    }
  }, [agents, createTab, navigate]);

  const handleEdit = (agentId: string) => navigate('agent-editor', { mode: 'edit', id: agentId });
  const handleFixConnector = () => navigate('llm-connectors');

  const handleRename = useCallback(async (agentId: string, newName: string) => {
    try {
      await window.hosea.agentConfig.update(agentId, { name: newName });
      setAgents((prev) => prev.map((a) => a.id === agentId ? { ...a, name: newName } : a));
    } catch (err) {
      console.error('[AgentsPage] handleRename error:', err);
    }
  }, []);

  const handleCopyId = useCallback((agentId: string) => {
    navigator.clipboard.writeText(agentId).catch(() => {});
  }, []);

  const handleArchive = useCallback(async (agentId: string) => {
    try {
      await window.hosea.agentConfig.update(agentId, { isArchived: true });
      setAgents((prev) => prev.map((a) => a.id === agentId ? { ...a, isArchived: true } : a));
    } catch (err) {
      console.error('[AgentsPage] handleArchive error:', err);
    }
  }, []);

  const handleUnarchive = useCallback(async (agentId: string) => {
    try {
      await window.hosea.agentConfig.update(agentId, { isArchived: false });
      setAgents((prev) => prev.map((a) => a.id === agentId ? { ...a, isArchived: false } : a));
      // Exit archived view immediately — agent is back in main list
      setFilters((f) => f.showArchived ? { ...f, showArchived: false } : f);
    } catch (err) {
      console.error('[AgentsPage] handleUnarchive error:', err);
    }
  }, []);

  const handlePin = useCallback(async (agentId: string) => {
    try {
      await window.hosea.agentConfig.update(agentId, { isPinned: true });
      setAgents((prev) => prev.map((a) => a.id === agentId ? { ...a, isPinned: true } : a));
    } catch (err) {
      console.error('[AgentsPage] handlePin error:', err);
    }
  }, []);

  const handleUnpin = useCallback(async (agentId: string) => {
    try {
      await window.hosea.agentConfig.update(agentId, { isPinned: false });
      setAgents((prev) => prev.map((a) => a.id === agentId ? { ...a, isPinned: false } : a));
    } catch (err) {
      console.error('[AgentsPage] handleUnpin error:', err);
    }
  }, []);

  const handleDuplicate = useCallback(async (agentId: string) => {
    try {
      const source = await window.hosea.agentConfig.get(agentId) as AgentListItem & Record<string, unknown>;
      if (!source) return;
      const { id: _id, createdAt: _c, updatedAt: _u, isActive: _a, ...rest } = source as any;
      const result = await window.hosea.agentConfig.create({
        ...rest,
        name: `${source.name} (copy)`,
        isPinned: false,
        isArchived: false,
      });
      if (result?.success) await loadData();
    } catch (err) {
      console.error('[AgentsPage] handleDuplicate error:', err);
    }
  }, [loadData]);

  const handleDelete = useCallback(async (agentId: string) => {
    try {
      await window.hosea.agentConfig.delete(agentId);
      setAgents((prev) => prev.filter((a) => a.id !== agentId));
    } catch (err) {
      console.error('[AgentsPage] handleDelete error:', err);
    }
  }, []);

  const handleSetDefault = useCallback(async (agentId: string) => {
    try {
      await window.hosea.agentConfig.setActive(agentId);
      setAgents((prev) => prev.map((a) => ({ ...a, isActive: a.id === agentId })));
    } catch (err) {
      console.error('[AgentsPage] handleSetDefault error:', err);
    }
  }, []);

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

      {/* Content */}
      <div className="page__content">
        {/* Stats bar */}
        <AgentStatsBar stats={stats} />

        {/* Toolbar — only when there are agents */}
        {agents.length > 0 && (
          <AgentToolbar
            filters={filters}
            activeCount={activeCount}
            archivedCount={archivedCount}
            totalVisible={visibleAgents.length}
            onFiltersChange={setFilters}
          />
        )}

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
                onRename={handleRename}
                onCopyId={handleCopyId}
                onArchive={handleArchive}
                onUnarchive={handleUnarchive}
                onPin={handlePin}
                onUnpin={handleUnpin}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
                onSetDefault={handleSetDefault}
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
