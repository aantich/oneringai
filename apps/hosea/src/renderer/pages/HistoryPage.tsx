/**
 * History Page - Browse and resume saved chat sessions
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Spinner, Badge } from 'react-bootstrap';
import { MessageSquare, Trash2, Bot, ChevronDown, ChevronRight, Save } from 'lucide-react';
import { PageHeader } from '../components/layout';
import { useNavigation } from '../hooks/useNavigation';
import { useTabContext } from '../hooks/useTabContext';

interface SessionInfo {
  sessionId: string;
  instanceId: string;
  title: string;
  createdAt: number;
  lastSavedAt: number;
  messageCount: number;
  model?: string;
}

interface AgentSessionGroup {
  agentConfigId: string;
  agentName: string;
  sessions: SessionInfo[];
}

export function HistoryPage(): React.ReactElement {
  const { navigate } = useNavigation();
  const { createTabFromSession } = useTabContext();
  const [groups, setGroups] = useState<AgentSessionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedAgents, setCollapsedAgents] = useState<Set<string>>(new Set());
  const [resumingSession, setResumingSession] = useState<string | null>(null);
  const [deletingSession, setDeletingSession] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const result = await window.hosea.history.listAll();
      // Sort groups by most recently saved session (desc)
      result.sort((a, b) => {
        const aLatest = Math.max(...a.sessions.map(s => s.lastSavedAt));
        const bLatest = Math.max(...b.sessions.map(s => s.lastSavedAt));
        return bLatest - aLatest;
      });
      // Sort sessions within groups by lastSavedAt (desc)
      for (const group of result) {
        group.sessions.sort((a, b) => b.lastSavedAt - a.lastSavedAt);
      }
      setGroups(result);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const handleResume = useCallback(async (agentConfigId: string, session: SessionInfo, agentName: string) => {
    setResumingSession(session.sessionId);
    try {
      const tabId = await createTabFromSession(agentConfigId, session.sessionId, session.instanceId, agentName, session.title);
      if (tabId) {
        navigate('chat');
      }
    } finally {
      setResumingSession(null);
    }
  }, [createTabFromSession, navigate]);

  const handleDelete = useCallback(async (instanceId: string, sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this session? This cannot be undone.')) return;
    setDeletingSession(sessionId);
    try {
      const result = await window.hosea.history.delete(instanceId, sessionId);
      if (result.success) {
        await loadSessions();
      }
    } finally {
      setDeletingSession(null);
    }
  }, [loadSessions]);

  const toggleAgent = useCallback((agentConfigId: string) => {
    setCollapsedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agentConfigId)) next.delete(agentConfigId);
      else next.add(agentConfigId);
      return next;
    });
  }, []);

  const formatDate = (ts: number) => {
    const date = new Date(ts);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const isYesterday = new Date(now.getTime() - 86400000).toDateString() === date.toDateString();

    if (isToday) return `Today ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
    if (isYesterday) return `Yesterday ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const totalSessions = groups.reduce((sum, g) => sum + g.sessions.length, 0);

  if (loading) {
    return (
      <div className="page">
        <PageHeader title="Session History" />
        <div className="page__content">
          <div className="d-flex justify-content-center align-items-center" style={{ minHeight: 200 }}>
            <Spinner animation="border" size="sm" className="me-2" />
            <span className="text-muted">Loading sessions...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Session History"
        subtitle={totalSessions > 0 ? `${totalSessions} saved session${totalSessions !== 1 ? 's' : ''}` : undefined}
      />
      <div className="page__content">
        {groups.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">
              <Save size={40} />
            </div>
            <h3 className="empty-state__title">No saved sessions yet</h3>
            <p className="empty-state__text">
              Enable session saving via the <Save size={14} style={{ verticalAlign: 'middle' }} /> icon in the tab bar to save your conversations.
            </p>
          </div>
        ) : (
          <div className="history-groups">
            {groups.map(group => {
              const isCollapsed = collapsedAgents.has(group.agentConfigId);
              return (
                <div key={group.agentConfigId} className="history-group">
                  <button
                    className="history-group__header"
                    onClick={() => toggleAgent(group.agentConfigId)}
                  >
                    {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                    <Bot size={16} className="history-group__icon" />
                    <span className="history-group__name">{group.agentName}</span>
                    <Badge bg="secondary" className="history-group__count">
                      {group.sessions.length}
                    </Badge>
                  </button>

                  {!isCollapsed && (
                    <div className="history-group__sessions">
                      {group.sessions.map(session => (
                        <div key={session.sessionId} className="history-session">
                          <div className="history-session__info">
                            <div className="history-session__title">{session.title}</div>
                            <div className="history-session__meta">
                              <span>{formatDate(session.lastSavedAt)}</span>
                              <span className="history-session__dot">&middot;</span>
                              <span>{session.messageCount} msg{session.messageCount !== 1 ? 's' : ''}</span>
                              {session.model && (
                                <>
                                  <span className="history-session__dot">&middot;</span>
                                  <span className="history-session__model">{session.model}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="history-session__actions">
                            <Button
                              variant="outline-danger"
                              size="sm"
                              onClick={(e) => handleDelete(session.instanceId, session.sessionId, e)}
                              disabled={deletingSession === session.sessionId}
                            >
                              {deletingSession === session.sessionId
                                ? <Spinner animation="border" size="sm" />
                                : <Trash2 size={14} />}
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => handleResume(group.agentConfigId, session, group.agentName)}
                              disabled={resumingSession === session.sessionId}
                            >
                              {resumingSession === session.sessionId ? (
                                <><Spinner animation="border" size="sm" className="me-1" /> Loading...</>
                              ) : (
                                <><MessageSquare size={14} className="me-1" /> Resume</>
                              )}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
