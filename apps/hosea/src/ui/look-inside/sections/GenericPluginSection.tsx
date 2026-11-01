/**
 * GenericPluginSection — Fallback renderer for plugins without a custom renderer.
 * Shows formatted content (if available) or raw JSON contents.
 */

import React from 'react';
import type { PluginRendererProps } from '../types.js';
import { formatNumber } from '../utils.js';

export const GenericPluginSection: React.FC<PluginRendererProps> = ({
  plugin,
}) => {
  return (
    <div className="look-inside-generic-plugin">
      <div className="look-inside-plugin-meta">
        <span className="look-inside-stat-label">Tokens</span>
        <span className="look-inside-stat-value">{formatNumber(plugin.tokenSize)}</span>
        {plugin.compactable && (
          <span className="look-inside-badge-compactable">compactable</span>
        )}
      </div>
      {plugin.formattedContent ? (
        <pre className="look-inside-code-block">
          <code>{plugin.formattedContent}</code>
        </pre>
      ) : plugin.contents != null ? (
        <pre className="look-inside-code-block">
          <code>{JSON.stringify(plugin.contents, null, 2)}</code>
        </pre>
      ) : (
        <div className="look-inside-muted">No content</div>
      )}
    </div>
  );
};
