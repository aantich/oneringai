/**
 * AgentCard — presentational card for a single AI agent.
 * Renders avatar (initials + deterministic color), metadata, capability chips,
 * and action buttons. All interaction is handled via callbacks.
 */
import React from 'react';
import { AlertTriangle, MoreVertical, MessageSquare, Pencil, Wrench } from 'lucide-react';
import type { AgentListItem } from './agentTypes.js';
import {
  getInitials,
  getAvatarHue,
  getDescription,
  getCapabilityChips,
  formatTimeAgo,
  isActiveToday,
} from './agentUtils.js';

interface AgentCardProps {
  agent: AgentListItem;
  isConnectorAvailable: boolean;
  isEwConnector: boolean;
  onChat: (id: string) => void;
  onEdit: (id: string) => void;
  onFixConnector: (id: string) => void;
}

export function AgentCard({
  agent,
  isConnectorAvailable,
  isEwConnector,
  onChat,
  onEdit,
  onFixConnector,
}: AgentCardProps): React.ReactElement {
  const desc = getDescription(agent.instructions);
  const chips = getCapabilityChips(agent);
  const activeToday = isActiveToday(agent);

  const cardClass = [
    'agent-card',
    agent.isActive ? 'agent-card--active' : '',
    !isConnectorAvailable ? 'agent-card--broken' : '',
  ]
    .filter(Boolean)
    .join(' ');

  function handleCardClick() {
    if (isConnectorAvailable) onChat(agent.id);
  }

  function handleCardKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (isConnectorAvailable) onChat(agent.id);
    }
  }

  return (
    <div className={cardClass} onClick={handleCardClick} onKeyDown={handleCardKeyDown} role="button" tabIndex={0}>
      {/* Body */}
      <div className="agent-card__body">
        {/* Top row */}
        <div className="agent-card__top">
          <div
            className="agent-card__avatar"
            style={{ '--avatar-hue': String(getAvatarHue(agent.name)) } as React.CSSProperties}
          >
            {getInitials(agent.name)}
          </div>

          <div className="agent-card__info">
            <div className="agent-card__name">
              {agent.name}
              {isEwConnector && <span className="agent-card__ew-badge">EW</span>}
              {!isConnectorAvailable && <AlertTriangle size={13} className="agent-card__warn" />}
            </div>
            <div className="agent-card__meta">
              <span className="agent-card__model-pill">{agent.model}</span>
              <span className="agent-card__meta-dot">·</span>
              via {agent.connector}
            </div>
          </div>

          <button
            className="agent-card__menu-btn"
            onClick={(e) => e.stopPropagation()}
            aria-label="More options"
          >
            <MoreVertical size={16} />
          </button>
        </div>

        {/* Description */}
        {desc && <p className="agent-card__desc">{desc}</p>}

        {/* Chips */}
        <div className="agent-card__chips">
          {isConnectorAvailable ? (
            chips.map((chip) => (
              <span key={chip.label} className="agent-card__chip">
                {chip.label}
              </span>
            ))
          ) : (
            <span className="agent-card__chip agent-card__chip--error">
              <AlertTriangle size={12} />
              Connector unavailable
            </span>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="agent-card__footer">
        <div className="agent-card__last-used">
          {isConnectorAvailable ? (
            <>
              <span
                className={`agent-card__status-dot${activeToday ? ' agent-card__status-dot--online' : ''}`}
              />
              {formatTimeAgo(agent.lastUsedAt)}
            </>
          ) : (
            <span className="agent-card__last-used--warning">
              <AlertTriangle size={13} />
              No connector
            </span>
          )}
        </div>

        <div className="agent-card__actions">
          {isConnectorAvailable ? (
            <>
              <button
                className="btn-card btn-card-edit"
                onClick={(e) => { e.stopPropagation(); onEdit(agent.id); }}
                aria-label="Edit agent"
              >
                <Pencil size={14} />
                Edit
              </button>
              <button
                className="btn-card btn-card-chat"
                onClick={(e) => { e.stopPropagation(); onChat(agent.id); }}
                aria-label="Chat with agent"
              >
                <MessageSquare size={14} />
                Chat
              </button>
            </>
          ) : (
            <>
              <button
                className="btn-card btn-card-fix"
                onClick={(e) => { e.stopPropagation(); onFixConnector(agent.id); }}
                aria-label="Fix connector"
              >
                <Wrench size={14} />
                Fix connector
              </button>
              <button
                className="btn-card btn-card-disabled"
                disabled
                aria-label="Chat with agent"
              >
                <MessageSquare size={14} />
                Chat
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
