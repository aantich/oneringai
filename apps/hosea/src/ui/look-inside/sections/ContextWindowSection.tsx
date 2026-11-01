/**
 * ContextWindowSection — Progress bar + token stats.
 */

import React from 'react';
import type { ContextBudget } from 'oneringai';
import { formatNumber, getUtilizationColor, getUtilizationLabel } from '../utils.js';

interface ContextWindowSectionProps {
  budget: ContextBudget;
  messagesCount: number;
  toolCallsCount: number;
  strategy: string;
}

export const ContextWindowSection: React.FC<ContextWindowSectionProps> = ({
  budget,
  messagesCount,
  toolCallsCount,
  strategy,
}) => {
  const colorClass = getUtilizationColor(budget.utilizationPercent);
  const label = getUtilizationLabel(budget.utilizationPercent);
  const pct = Math.min(budget.utilizationPercent, 100);

  return (
    <div className="look-inside-context-window">
      <div className="look-inside-progress-bar-container">
        <div
          className={`look-inside-progress-bar ${colorClass}`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <div className="look-inside-context-stats">
        <span className={`look-inside-utilization-label ${colorClass}`}>
          {pct.toFixed(1)}% — {label}
        </span>
        <span className="look-inside-context-stat">
          {formatNumber(budget.totalUsed)} / {formatNumber(budget.maxTokens)} tokens
        </span>
      </div>
      <div className="look-inside-context-details">
        <div className="look-inside-stat-row">
          <span className="look-inside-stat-label">Available</span>
          <span className="look-inside-stat-value">{formatNumber(budget.available)} tokens</span>
        </div>
        <div className="look-inside-stat-row">
          <span className="look-inside-stat-label">Response Reserve</span>
          <span className="look-inside-stat-value">{formatNumber(budget.responseReserve)} tokens</span>
        </div>
        <div className="look-inside-stat-row">
          <span className="look-inside-stat-label">Messages</span>
          <span className="look-inside-stat-value">{messagesCount}</span>
        </div>
        <div className="look-inside-stat-row">
          <span className="look-inside-stat-label">Tool Calls</span>
          <span className="look-inside-stat-value">{toolCallsCount}</span>
        </div>
        <div className="look-inside-stat-row">
          <span className="look-inside-stat-label">Strategy</span>
          <span className="look-inside-stat-value">{strategy}</span>
        </div>
      </div>
    </div>
  );
};
