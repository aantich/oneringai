/**
 * InContextMemoryRenderer — Displays in-context memory entries with priority badges.
 */

import React from 'react';
import type { PluginRendererProps } from '../types.js';
import { formatTimestamp } from '../utils.js';

interface InContextEntry {
  key: string;
  description: string;
  priority: string;
  updatedAt: number;
  value: unknown;
}

export const InContextMemoryRenderer: React.FC<PluginRendererProps> = ({
  plugin,
}) => {
  const entries = (plugin.contents as InContextEntry[] | null) ?? [];

  if (entries.length === 0) {
    return <div className="look-inside-muted">No entries in context memory</div>;
  }

  return (
    <div className="look-inside-in-context-memory">
      <div className="look-inside-entry-count">
        {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
      </div>
      <div className="look-inside-entry-list">
        {entries.map((entry) => (
          <div key={entry.key} className="look-inside-entry-item">
            <div className="look-inside-entry-header">
              <code className="look-inside-entry-key">{entry.key}</code>
              <span className={`look-inside-priority look-inside-priority-${entry.priority}`}>
                {entry.priority}
              </span>
            </div>
            <div className="look-inside-entry-desc">{entry.description}</div>
            <div className="look-inside-entry-value">
              <pre className="look-inside-code-block-sm">
                <code>
                  {typeof entry.value === 'string'
                    ? entry.value
                    : JSON.stringify(entry.value, null, 2)}
                </code>
              </pre>
            </div>
            <div className="look-inside-entry-meta">
              <span>{formatTimestamp(entry.updatedAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
