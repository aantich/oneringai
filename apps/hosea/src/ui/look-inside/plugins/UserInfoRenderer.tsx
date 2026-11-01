/**
 * UserInfoRenderer — Displays user info entries.
 */

import React from 'react';
import type { PluginRendererProps } from '../types.js';
import { formatTimestamp } from '../utils.js';

interface UserInfoEntry {
  key: string;
  value: unknown;
  valueType: string;
  description?: string;
  updatedAt: number;
}

export const UserInfoRenderer: React.FC<PluginRendererProps> = ({
  plugin,
}) => {
  const entries = (plugin.contents as UserInfoEntry[] | null) ?? [];

  if (entries.length === 0) {
    return <div className="look-inside-muted">No user info stored</div>;
  }

  return (
    <div className="look-inside-user-info">
      <div className="look-inside-entry-count">
        {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
      </div>
      <div className="look-inside-entry-list">
        {entries.map((entry) => (
          <div key={entry.key} className="look-inside-entry-item">
            <div className="look-inside-entry-header">
              <code className="look-inside-entry-key">{entry.key}</code>
              <span className="look-inside-entry-type">{entry.valueType}</span>
            </div>
            {entry.description && (
              <div className="look-inside-entry-desc">{entry.description}</div>
            )}
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
