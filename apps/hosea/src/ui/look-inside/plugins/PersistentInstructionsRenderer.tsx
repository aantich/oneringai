/**
 * PersistentInstructionsRenderer — Displays persistent instruction entries.
 */

import React from 'react';
import type { PluginRendererProps } from '../types.js';
import { formatTimestamp } from '../utils.js';

interface InstructionEntry {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export const PersistentInstructionsRenderer: React.FC<PluginRendererProps> = ({
  plugin,
}) => {
  const entries = (plugin.contents as InstructionEntry[] | null) ?? [];

  if (entries.length === 0) {
    return <div className="look-inside-muted">No persistent instructions</div>;
  }

  return (
    <div className="look-inside-persistent-instructions">
      <div className="look-inside-entry-count">
        {entries.length} instruction{entries.length !== 1 ? 's' : ''}
      </div>
      <div className="look-inside-entry-list">
        {entries.map((entry) => (
          <div key={entry.id} className="look-inside-entry-item">
            <div className="look-inside-entry-header">
              <code className="look-inside-entry-key">{entry.id}</code>
              <span className="look-inside-entry-meta-inline">
                {formatTimestamp(entry.updatedAt)}
              </span>
            </div>
            <pre className="look-inside-code-block-sm">
              <code>{entry.content}</code>
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
};
