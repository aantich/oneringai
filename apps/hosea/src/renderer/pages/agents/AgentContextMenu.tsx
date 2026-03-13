/**
 * AgentContextMenu — dropdown triggered by the ⋮ button on an agent card.
 * Portaled to document.body to escape card overflow clipping.
 *
 * NOTE: wrapping div has onClick stopPropagation to prevent React portal
 * event bubbling from triggering the parent card's click handler.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Archive, ArchiveRestore, Pencil, Pin, PinOff, Copy as CopyIcon, Trash2, Star, AlertTriangle } from 'lucide-react';

interface AgentContextMenuProps {
  agentId: string;
  isArchived: boolean;
  isPinned: boolean;
  isDefault: boolean;
  anchorEl: HTMLElement;
  onClose: () => void;
  onCopyId: (id: string) => void;
  onRename: (id: string) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onPin: (id: string) => void;
  onUnpin: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
}

export function AgentContextMenu({
  agentId,
  isArchived,
  isPinned,
  isDefault,
  anchorEl,
  onClose,
  onCopyId,
  onRename,
  onArchive,
  onUnarchive,
  onPin,
  onUnpin,
  onDuplicate,
  onDelete,
  onSetDefault,
}: AgentContextMenuProps): React.ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const rect = anchorEl.getBoundingClientRect();
    const menuH = 300;
    const menuW = 188;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= menuH ? rect.bottom + 4 : rect.top - menuH - 4;
    const left = Math.min(rect.left, window.innerWidth - menuW - 8);
    setPos({ top, left });
  }, [anchorEl]);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  function handleItem(cb: () => void) {
    cb();
    onClose();
  }

  return createPortal(
    // stopPropagation prevents React portal events from bubbling to card onClick
    <div
      ref={menuRef}
      className="agent-menu"
      style={{ top: pos.top, left: pos.left }}
      role="menu"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="agent-menu__item"
        role="menuitem"
        onClick={() => handleItem(() => onRename(agentId))}
      >
        <Pencil size={14} />
        Rename
      </button>

      <button
        type="button"
        className="agent-menu__item"
        role="menuitem"
        onClick={() => handleItem(() => (isPinned ? onUnpin : onPin)(agentId))}
      >
        {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
        {isPinned ? 'Unpin' : 'Pin to top'}
      </button>

      <button
        type="button"
        className="agent-menu__item"
        role="menuitem"
        onClick={() => handleItem(() => onDuplicate(agentId))}
      >
        <CopyIcon size={14} />
        Duplicate
      </button>

      {!isDefault && (
        <button
          type="button"
          className="agent-menu__item"
          role="menuitem"
          onClick={() => handleItem(() => onSetDefault(agentId))}
        >
          <Star size={14} />
          Set as default
        </button>
      )}

      <button
        type="button"
        className="agent-menu__item"
        role="menuitem"
        onClick={() => handleItem(() => onCopyId(agentId))}
      >
        <Copy size={14} />
        Copy ID
      </button>

      <div className="agent-menu__divider" />

      {isArchived ? (
        <button
          type="button"
          className="agent-menu__item"
          role="menuitem"
          onClick={() => handleItem(() => onUnarchive(agentId))}
        >
          <ArchiveRestore size={14} />
          Unarchive
        </button>
      ) : (
        <button
          type="button"
          className="agent-menu__item agent-menu__item--danger"
          role="menuitem"
          onClick={() => handleItem(() => onArchive(agentId))}
        >
          <Archive size={14} />
          Archive
        </button>
      )}

      {confirmDelete ? (
        <button
          type="button"
          className="agent-menu__item agent-menu__item--confirm-delete"
          role="menuitem"
          onClick={() => handleItem(() => onDelete(agentId))}
        >
          <AlertTriangle size={14} />
          Confirm delete
        </button>
      ) : (
        <button
          type="button"
          className="agent-menu__item agent-menu__item--danger"
          role="menuitem"
          onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
        >
          <Trash2 size={14} />
          Delete
        </button>
      )}
    </div>,
    document.body,
  );
}
