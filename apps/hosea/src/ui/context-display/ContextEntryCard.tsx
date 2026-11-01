import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Maximize2,
  Minimize2,
  GripVertical,
  Pencil,
  Check,
  Pin,
  PinOff,
  Loader2,
} from 'lucide-react';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer.js';
import { formatValueForDisplay, PRIORITY_CLASSES } from './utils.js';
import type { InContextEntry } from 'oneringai';
import type { OnInteractiveAction } from '../interactive-ui/types.js';

const MIN_TEXTAREA_ROWS = 6;

interface IContextEntryCardProps {
  entry: InContextEntry;
  isCollapsed: boolean;
  isMaximized: boolean;
  isHighlighted: boolean;
  forceExpanded: boolean;

  // Drag-and-drop
  enableDragAndDrop: boolean;
  isDragging: boolean;
  dropPosition: 'above' | 'below' | null;
  onDragStart: (key: string, e: React.DragEvent) => void;
  onDragOver: (key: string, e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (key: string, e: React.DragEvent) => void;
  onDragEnd: () => void;

  // Editing
  enableEditing: boolean;
  onSaveEntry?: (key: string, newValue: string) => Promise<void>;

  // Pin
  isPinned?: boolean;
  onPinToggle?: (key: string, pinned: boolean) => void;

  // Actions
  onCollapseToggle: (key: string) => void;
  onMaximizeToggle: (key: string) => void;

  // Interactive UI
  onInteractiveAction?: OnInteractiveAction;
}

export const ContextEntryCard: React.FC<IContextEntryCardProps> = ({
  entry,
  isCollapsed,
  isMaximized,
  isHighlighted,
  forceExpanded,
  enableDragAndDrop,
  isDragging,
  dropPosition,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  enableEditing,
  onSaveEntry,
  isPinned,
  onPinToggle,
  onCollapseToggle,
  onMaximizeToggle,
  onInteractiveAction,
}) => {
  const displayValue = useMemo(() => formatValueForDisplay(entry.value), [entry.value]);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(displayValue);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setEditValue(displayValue);
  }, [displayValue]);

  const hasChanges = editValue !== displayValue;
  const isDragDisabled = !enableDragAndDrop || forceExpanded || isMaximized;

  const handleSave = useCallback(async () => {
    if (!onSaveEntry || !hasChanges) return;
    setIsSaving(true);
    try {
      await onSaveEntry(entry.key, editValue);
      setIsEditing(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[ContextEntryCard] Save failed:', message);
    } finally {
      setIsSaving(false);
    }
  }, [onSaveEntry, entry.key, editValue, hasChanges]);

  const handleEditToggle = useCallback(() => {
    if (isEditing && hasChanges) {
      setEditValue(displayValue);
    }
    setIsEditing((prev) => !prev);
  }, [isEditing, hasChanges, displayValue]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onCollapseToggle(entry.key);
      }
    },
    [entry.key, onCollapseToggle],
  );

  const cardClasses = [
    'cdp-card',
    isHighlighted && !forceExpanded ? 'cdp-card--highlight' : '',
    isMaximized && !forceExpanded ? 'cdp-card--maximized' : '',
    isCollapsed ? 'cdp-card--collapsed' : '',
    isPinned ? 'cdp-card--pinned' : '',
    forceExpanded ? 'cdp-card--export' : '',
    isDragging ? 'cdp-card--dragging' : '',
    dropPosition === 'above' ? 'cdp-card--drop-above' : '',
    dropPosition === 'below' ? 'cdp-card--drop-below' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      data-entry-key={entry.key}
      className={cardClasses}
      role="listitem"
      draggable={!isDragDisabled}
      onDragStart={(e) => !isDragDisabled && onDragStart(entry.key, e)}
      onDragOver={(e) => !isDragDisabled && onDragOver(entry.key, e)}
      onDragLeave={!isDragDisabled ? onDragLeave : undefined}
      onDrop={(e) => !isDragDisabled && onDrop(entry.key, e)}
      onDragEnd={!isDragDisabled ? onDragEnd : undefined}
    >
      {/* Header — hidden during export */}
      {!forceExpanded && (
        <div
          className="cdp-card__header"
          role="button"
          tabIndex={0}
          aria-expanded={!isCollapsed}
          onClick={() => onCollapseToggle(entry.key)}
          onKeyDown={handleKeyDown}
        >
          <div className="cdp-card__title">
            {!isDragDisabled && (
              <span
                className="cdp-drag-handle"
                onClick={(e) => e.stopPropagation()}
                title="Drag to reorder"
              >
                <GripVertical size={12} />
              </span>
            )}
            <span className="cdp-card__collapse-icon">
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </span>
            <span
              className="cdp-card__key"
              title={`${entry.key}${entry.priority ? ` [${entry.priority}]` : ''}`}
            >
              {entry.description || entry.key}
            </span>
            {entry.priority && (
              <span className={`cdp-priority ${PRIORITY_CLASSES[entry.priority] || ''}`}>
                {entry.priority}
              </span>
            )}
          </div>
          <div
            className="cdp-card__actions"
            role="toolbar"
            aria-label="Entry actions"
            onClick={(e) => e.stopPropagation()}
          >
            {isEditing && hasChanges && (
              <button
                className="cdp-action-btn cdp-action-btn--save"
                onClick={handleSave}
                disabled={isSaving}
                title="Save changes"
              >
                {isSaving ? (
                  <Loader2 size={14} className="cdp-spinner" />
                ) : (
                  <Check size={14} />
                )}
              </button>
            )}
            {enableEditing && !forceExpanded && (
              <button
                className={`cdp-action-btn ${isEditing ? 'cdp-action-btn--active' : ''}`}
                onClick={handleEditToggle}
                title={isEditing ? 'Exit edit mode' : 'Edit raw markdown'}
              >
                <Pencil size={14} />
              </button>
            )}
            <button
              className={`cdp-action-btn ${isMaximized ? 'cdp-action-btn--active' : ''}`}
              onClick={() => onMaximizeToggle(entry.key)}
              title={isMaximized ? 'Exit full view' : 'Full view'}
            >
              {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            {onPinToggle && (
              <button
                className={`cdp-action-btn ${isPinned ? 'cdp-action-btn--active' : ''}`}
                onClick={() => onPinToggle(entry.key, !isPinned)}
                title={isPinned ? 'Unpin (stop always showing)' : 'Pin (always show this entry)'}
              >
                {isPinned ? <Pin size={14} /> : <PinOff size={14} />}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Body — markdown value or edit textarea */}
      {!isCollapsed && (
        <div className="cdp-card__body">
          {isEditing ? (
            <textarea
              className="cdp-edit-textarea"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              rows={Math.max(MIN_TEXTAREA_ROWS, editValue.split('\n').length + 1)}
              disabled={isSaving}
              aria-label={`Edit ${entry.key}`}
            />
          ) : (
            <div className="cdp-card__markdown">
              <MarkdownRenderer content={displayValue} onInteractiveAction={onInteractiveAction} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
