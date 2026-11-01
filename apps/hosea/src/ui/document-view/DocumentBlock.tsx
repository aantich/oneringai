import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, X, Check, EyeOff, Eye, Loader2 } from 'lucide-react';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer.js';
import { formatValueForDisplay } from '../context-display/utils.js';
import type { IDocumentBlockProps } from './types.js';

const MIN_TEXTAREA_ROWS = 8;

export const DocumentBlock: React.FC<IDocumentBlockProps> = ({
  entry,
  isExcluded,
  onToggleExclude,
  onSaveEntry,
  readOnly,
}) => {
  const displayValue = useMemo(() => formatValueForDisplay(entry.value), [entry.value]);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(displayValue);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setEditValue(displayValue);
  }, [displayValue]);

  const hasChanges = editValue !== displayValue;

  const handleSave = useCallback(async () => {
    if (!onSaveEntry || !hasChanges) return;
    setIsSaving(true);
    try {
      await onSaveEntry(entry.key, editValue);
      setIsEditing(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[DocumentBlock] Save failed:', message);
    } finally {
      setIsSaving(false);
    }
  }, [onSaveEntry, entry.key, editValue, hasChanges]);

  const handleCancel = useCallback(() => {
    setEditValue(displayValue);
    setIsEditing(false);
  }, [displayValue]);

  const blockClasses = [
    'dv-block',
    isExcluded ? 'dv-block--excluded' : '',
    isEditing ? 'dv-block--editing' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={blockClasses} data-entry-key={entry.key}>
      {/* Block toolbar - subtle, visible on hover */}
      <div className="dv-block__toolbar">
        <span className="dv-block__title" title={entry.key}>
          {entry.description || entry.key}
        </span>
        <div className="dv-block__actions">
          {isEditing && hasChanges && (
            <button
              className="dv-block__btn dv-block__btn--save"
              onClick={handleSave}
              disabled={isSaving}
              title="Save changes"
            >
              {isSaving ? <Loader2 size={14} className="dv-spinner" /> : <Check size={14} />}
            </button>
          )}
          {isEditing && (
            <button
              className="dv-block__btn dv-block__btn--cancel"
              onClick={handleCancel}
              title="Cancel editing"
            >
              <X size={14} />
            </button>
          )}
          {!isEditing && onSaveEntry && !readOnly && (
            <button
              className="dv-block__btn"
              onClick={() => setIsEditing(true)}
              title="Edit raw markdown"
            >
              <Pencil size={14} />
            </button>
          )}
          <button
            className={`dv-block__btn ${isExcluded ? 'dv-block__btn--active' : ''}`}
            onClick={() => onToggleExclude(entry.key)}
            title={isExcluded ? 'Include in document' : 'Exclude from document'}
          >
            {isExcluded ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      {/* Block content */}
      <div className="dv-block__content">
        {isEditing ? (
          <textarea
            className="dv-block__editor"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            rows={Math.max(MIN_TEXTAREA_ROWS, editValue.split('\n').length + 2)}
            disabled={isSaving}
            autoFocus
          />
        ) : isExcluded ? (
          <div className="dv-block__excluded-placeholder">
            <EyeOff size={16} />
            <span>Block excluded from document</span>
          </div>
        ) : (
          <div className="dv-block__markdown">
            <MarkdownRenderer content={displayValue} />
          </div>
        )}
      </div>
    </div>
  );
};
