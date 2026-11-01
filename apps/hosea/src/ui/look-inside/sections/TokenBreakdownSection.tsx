/**
 * TokenBreakdownSection — Bar chart from budget.breakdown.
 */

import React from 'react';
import type { ContextBudget } from 'oneringai';
import { formatNumber } from '../utils.js';

interface TokenBreakdownSectionProps {
  budget: ContextBudget;
}

interface BreakdownItem {
  name: string;
  tokens: number;
  percent: number;
}

export const TokenBreakdownSection: React.FC<TokenBreakdownSectionProps> = ({
  budget,
}) => {
  const { breakdown } = budget;
  const total = budget.totalUsed || 1; // avoid divide by zero

  const items: BreakdownItem[] = [
    { name: 'System Prompt', tokens: breakdown.systemPrompt, percent: (breakdown.systemPrompt / total) * 100 },
    { name: 'Persistent Instructions', tokens: breakdown.persistentInstructions, percent: (breakdown.persistentInstructions / total) * 100 },
    { name: 'Plugin Instructions', tokens: breakdown.pluginInstructions, percent: (breakdown.pluginInstructions / total) * 100 },
    ...Object.entries(breakdown.pluginContents).map(([name, tokens]) => ({
      name: `Plugin: ${formatPluginLabel(name)}`,
      tokens,
      percent: (tokens / total) * 100,
    })),
    { name: 'Tools', tokens: breakdown.tools, percent: (breakdown.tools / total) * 100 },
    { name: 'Conversation', tokens: breakdown.conversation, percent: (breakdown.conversation / total) * 100 },
    { name: 'Current Input', tokens: breakdown.currentInput, percent: (breakdown.currentInput / total) * 100 },
  ].filter((item) => item.tokens > 0);

  return (
    <div className="look-inside-token-breakdown">
      {items.map((item) => (
        <div key={item.name} className="look-inside-breakdown-row">
          <div className="look-inside-breakdown-label">
            <span className="look-inside-breakdown-name">{item.name}</span>
            <span className="look-inside-breakdown-tokens">
              {formatNumber(item.tokens)} ({item.percent.toFixed(1)}%)
            </span>
          </div>
          <div className="look-inside-breakdown-bar-container">
            <div
              className="look-inside-breakdown-bar"
              style={{ width: `${Math.max(item.percent, 0.5)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

function formatPluginLabel(name: string): string {
  return name
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
