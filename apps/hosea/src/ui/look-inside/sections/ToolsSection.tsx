/**
 * ToolsSection — Tool list with enabled/disabled badges and call counts.
 */

import React, { useState, useMemo } from 'react';
import type { IToolSnapshot } from '../types.js';
import { truncateText } from '../utils.js';

interface ToolsSectionProps {
  tools: IToolSnapshot[];
}

export const ToolsSection: React.FC<ToolsSectionProps> = ({ tools }) => {
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter) return tools;
    const lower = filter.toLowerCase();
    return tools.filter(
      (t) =>
        t.name.toLowerCase().includes(lower) ||
        t.description.toLowerCase().includes(lower) ||
        (t.namespace && t.namespace.toLowerCase().includes(lower))
    );
  }, [tools, filter]);

  const enabledCount = tools.filter((t) => t.enabled).length;

  return (
    <div className="look-inside-tools">
      <div className="look-inside-tools-header">
        <span className="look-inside-tools-count">
          {enabledCount} / {tools.length} enabled
        </span>
        {tools.length > 5 && (
          <input
            type="text"
            className="look-inside-tools-filter"
            placeholder="Filter tools..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}
      </div>
      <div className="look-inside-tools-list">
        {filtered.map((tool) => (
          <div
            key={tool.name}
            className={`look-inside-tool-item ${!tool.enabled ? 'look-inside-tool-disabled' : ''}`}
          >
            <div className="look-inside-tool-name">
              <span className={`look-inside-tool-badge ${tool.enabled ? 'look-inside-badge-on' : 'look-inside-badge-off'}`}>
                {tool.enabled ? 'ON' : 'OFF'}
              </span>
              <code>{tool.name}</code>
              {tool.namespace && (
                <span className="look-inside-tool-namespace">{tool.namespace}</span>
              )}
            </div>
            <div className="look-inside-tool-meta">
              <span className="look-inside-tool-desc">
                {truncateText(tool.description, 120)}
              </span>
              {tool.callCount > 0 && (
                <span className="look-inside-tool-calls">
                  {tool.callCount} call{tool.callCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="look-inside-muted">
            {filter ? 'No tools match filter' : 'No tools registered'}
          </div>
        )}
      </div>
    </div>
  );
};
