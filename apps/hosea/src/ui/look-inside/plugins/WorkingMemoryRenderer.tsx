/**
 * WorkingMemoryRenderer — Displays working memory entries with key, scope, priority.
 * Supports optional click-to-expand for lazy value loading (e.g., via IPC in Hosea).
 */

import React from 'react';
import type { PluginRendererProps } from '../types.js';
import { formatBytes, formatTimestamp } from '../utils.js';

interface WorkingMemoryEntry {
  key: string;
  description: string;
  scope: unknown;
  basePriority?: string;
  sizeBytes?: number;
  tier?: string;
  updatedAt?: number;
}

interface WorkingMemoryContents {
  entries: WorkingMemoryEntry[];
}

export const WorkingMemoryRenderer: React.FC<PluginRendererProps> = ({
  plugin,
  onEntryClick,
  entryValues,
  loadingEntryKey,
}) => {
  // Handle both formats: array directly (from getAll()) or wrapped { entries }
  const raw = plugin.contents;
  const entries: WorkingMemoryEntry[] = Array.isArray(raw)
    ? raw
    : (raw as WorkingMemoryContents | null)?.entries ?? [];

  if (entries.length === 0) {
    return <div className="look-inside-muted">No entries in working memory</div>;
  }

  const isClickable = !!onEntryClick;

  return (
    <div className="look-inside-working-memory">
      <div className="look-inside-entry-count">
        {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
      </div>
      <div className="look-inside-entry-list">
        {entries.map((entry) => {
          const scope = typeof entry.scope === 'object'
            ? JSON.stringify(entry.scope)
            : String(entry.scope ?? 'session');

          const isLoading = loadingEntryKey === entry.key;
          const hasValue = entryValues?.has(entry.key) ?? false;
          const isExpanded = hasValue || isLoading;

          return (
            <div
              key={entry.key}
              className={`look-inside-entry-item ${isClickable ? 'look-inside-entry-clickable' : ''} ${isExpanded ? 'look-inside-entry-expanded' : ''}`}
              onClick={isClickable ? () => onEntryClick(entry.key) : undefined}
              role={isClickable ? 'button' : undefined}
              tabIndex={isClickable ? 0 : undefined}
            >
              <div className="look-inside-entry-header">
                <code className="look-inside-entry-key">{entry.key}</code>
                <span className={`look-inside-priority look-inside-priority-${entry.basePriority ?? 'normal'}`}>
                  {entry.basePriority ?? 'normal'}
                </span>
              </div>
              <div className="look-inside-entry-desc">{entry.description}</div>
              <div className="look-inside-entry-meta">
                <span>Scope: {scope}</span>
                {entry.tier && <span>Tier: {entry.tier}</span>}
                {entry.sizeBytes != null && (
                  <span>Size: {formatBytes(entry.sizeBytes)}</span>
                )}
                {entry.updatedAt && (
                  <span>{formatTimestamp(entry.updatedAt)}</span>
                )}
              </div>
              {/* Expanded value (lazy-loaded) */}
              {isLoading && (
                <div className="look-inside-entry-loading">Loading value...</div>
              )}
              {hasValue && !isLoading && (
                <pre className="look-inside-code-block-sm">
                  {JSON.stringify(entryValues!.get(entry.key), null, 2)}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
