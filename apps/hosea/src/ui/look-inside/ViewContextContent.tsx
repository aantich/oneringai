/**
 * ViewContextContent — "View Full Context" content (no modal wrapper).
 *
 * Renders the prepared context breakdown with named components,
 * token estimates, and a "Copy All" button. Apps provide their own modal.
 */

import React from 'react';
import type { ViewContextContentProps, IViewContextComponent } from './types.js';
import { formatNumber } from './utils.js';

export const ViewContextContent: React.FC<ViewContextContentProps> = ({
  data,
  loading = false,
  error = null,
  onCopyAll,
  className,
}) => {
  if (loading) {
    return (
      <div className={`look-inside-view-context look-inside-loading ${className ?? ''}`}>
        <div className="look-inside-spinner">Preparing context...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`look-inside-view-context look-inside-error ${className ?? ''}`}>
        <div className="look-inside-error-message">{error}</div>
      </div>
    );
  }

  if (!data || !data.available) {
    return (
      <div className={`look-inside-view-context ${className ?? ''}`}>
        <div className="look-inside-muted">Context not available</div>
      </div>
    );
  }

  return (
    <div className={`look-inside-view-context ${className ?? ''}`}>
      <div className="look-inside-view-context-header">
        <span className="look-inside-view-context-total">
          Total: {formatNumber(data.totalTokens)} tokens
          ({data.components.length} component{data.components.length !== 1 ? 's' : ''})
        </span>
        {onCopyAll && (
          <button
            type="button"
            className="look-inside-btn look-inside-btn-secondary"
            onClick={onCopyAll}
          >
            Copy All
          </button>
        )}
      </div>
      <div className="look-inside-view-context-components">
        {data.components.map((component: IViewContextComponent, index: number) => (
          <div key={index} className="look-inside-view-context-component">
            <div className="look-inside-view-context-component-header">
              <span className="look-inside-view-context-component-name">
                {component.name}
              </span>
              <span className="look-inside-view-context-component-tokens">
                ~{formatNumber(component.tokenEstimate)} tokens
              </span>
            </div>
            <pre className="look-inside-code-block">
              <code>{component.content}</code>
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
};
