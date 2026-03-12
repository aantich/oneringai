/**
 * AgentStatsBar — displays high-level stats about agents.
 * Renders a horizontal bar with 3 stat items: total count, active today, and tool count.
 */
import React from 'react';
import { Bot, CheckCircle, Wrench } from 'lucide-react';
import type { AgentStats } from './agentTypes.js';

interface AgentStatsBarProps {
  stats: AgentStats;
}

export function AgentStatsBar({ stats }: AgentStatsBarProps): React.ReactElement {
  const statItems = [
    {
      icon: <Bot size={15} />,
      value: stats.total,
      label: 'TOTAL',
    },
    {
      icon: <CheckCircle size={15} />,
      value: stats.activeToday,
      label: 'ACTIVE TODAY',
    },
    {
      icon: <Wrench size={15} />,
      value: stats.totalTools,
      label: 'TOOLS',
    },
  ];

  return (
    <div className="agents-stats-bar">
      {statItems.map((item, idx) => (
        <div key={idx} className="agents-stat-item">
          <div className="agents-stat-icon">{item.icon}</div>
          <div>
            <div className="agents-stat-value">{item.value}</div>
            <div className="agents-stat-label">{item.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
