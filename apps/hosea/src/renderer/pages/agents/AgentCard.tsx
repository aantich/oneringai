/**
 * AgentCard — presentational card for a single AI agent.
 * Renders avatar (initials + deterministic color), metadata, capability chips,
 * and action buttons. All interaction is handled via callbacks.
 */
import React, { useRef, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, MoreVertical, MessageSquare, Pencil, Wrench, Pin as PinIcon, Star } from 'lucide-react';
import type { AgentListItem } from './agentTypes.js';
import {
  getInitials,
  getAvatarHue,
  getDescription,
  getCapabilityChips,
  formatTimeAgo,
  isActiveToday,
} from './agentUtils.js';
import { AgentContextMenu } from './AgentContextMenu.js';

interface AgentCardProps {
  agent: AgentListItem;
  isConnectorAvailable: boolean;
  isEwConnector: boolean;
  onChat: (id: string) => void;
  onEdit: (id: string) => void;
  onFixConnector: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  onCopyId: (id: string) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onPin: (id: string) => void;
  onUnpin: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
}

export function AgentCard({
  agent,
  isConnectorAvailable,
  isEwConnector,
  onChat,
  onEdit,
  onFixConnector,
  onRename,
  onCopyId,
  onArchive,
  onUnarchive,
  onPin,
  onUnpin,
  onDuplicate,
  onDelete,
  onSetDefault,
}: AgentCardProps): React.ReactElement {
  const desc = getDescription(agent.instructions);
  const chips = getCapabilityChips(agent);
  const activeToday = isActiveToday(agent);

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(agent.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const cardClass = clsx(
    'agent-card',
    agent.isActive && 'agent-card--active',
    !isConnectorAvailable && 'agent-card--broken',
    agent.isArchived && 'agent-card--archived',
    agent.isPinned && 'agent-card--pinned',
  );

  function handleCardClick() {
    if (isConnectorAvailable && !renaming && !menuAnchor) onChat(agent.id);
  }

  function handleCardKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (isConnectorAvailable && !renaming && !menuAnchor) onChat(agent.id);
    }
  }

  function handleMenuClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
  }

  function handleRenameStart(id: string) {
    setRenameValue(agent.name);
    setRenaming(true);
    setTimeout(() => renameInputRef.current?.select(), 0);
  }

  function handleRenameCommit() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== agent.name) {
      onRename(agent.id, trimmed);
    }
    setRenaming(false);
  }

  function handleRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleRenameCommit();
    if (e.key === 'Escape') setRenaming(false);
  }

  return (
    <div className={cardClass} onClick={handleCardClick} onKeyDown={handleCardKeyDown} tabIndex={0}>
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
              {renaming ? (
                <input
                  ref={renameInputRef}
                  className="agent-card__rename-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={handleRenameCommit}
                  onKeyDown={handleRenameKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  maxLength={80}
                  autoFocus
                />
              ) : (
                <>
                  {agent.name}
                  {isEwConnector && <span className="agent-card__ew-badge">EW</span>}
                  {agent.isActive && <span className="agent-card__default-badge"><Star size={9} />Default</span>}
                  {!isConnectorAvailable && <AlertTriangle size={13} className="agent-card__warn" />}
                </>
              )}
            </div>
            <div className="agent-card__meta">
              <span className="agent-card__model-pill">{agent.model}</span>
              <span className="agent-card__meta-dot">·</span>
              via {agent.connector}
            </div>
          </div>

          {agent.isPinned && (
            <div className="agent-card__pin-icon" title="Pinned">
              <PinIcon size={12} />
            </div>
          )}

          <button
            type="button"
            className="agent-card__menu-btn"
            onClick={handleMenuClick}
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
                type="button"
                className="btn-card btn-card-edit"
                onClick={(e) => { e.stopPropagation(); onEdit(agent.id); }}
                aria-label="Edit agent"
              >
                <Pencil size={14} />
                Edit
              </button>
              <button
                type="button"
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
                type="button"
                className="btn-card btn-card-fix"
                onClick={(e) => { e.stopPropagation(); onFixConnector(agent.id); }}
                aria-label="Fix connector"
              >
                <Wrench size={14} />
                Fix connector
              </button>
              <button
                type="button"
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

      {/* Context menu portal */}
      {menuAnchor && (
        <AgentContextMenu
          agentId={agent.id}
          isArchived={agent.isArchived ?? false}
          isPinned={agent.isPinned ?? false}
          isDefault={agent.isActive}
          anchorEl={menuAnchor}
          onClose={() => setMenuAnchor(null)}
          onCopyId={onCopyId}
          onRename={handleRenameStart}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
          onPin={onPin}
          onUnpin={onUnpin}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onSetDefault={onSetDefault}
        />
      )}
    </div>
  );
}
