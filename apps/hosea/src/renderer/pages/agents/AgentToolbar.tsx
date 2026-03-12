/**
 * AgentToolbar — search and filter UI for agents.
 * Includes search box, active filter button, and visible count label.
 */
import React from 'react';
import { Search, CheckCircle } from 'lucide-react';
import type { AgentFilters } from './agentTypes.js';

interface AgentToolbarProps {
  filters: AgentFilters;
  activeCount: number;
  totalVisible: number;
  onFiltersChange: (filters: AgentFilters) => void;
}

export function AgentToolbar({
  filters,
  activeCount,
  totalVisible,
  onFiltersChange,
}: AgentToolbarProps): React.ReactElement {
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFiltersChange({ ...filters, query: e.target.value });
  };

  const handleActiveFilterClick = () => {
    onFiltersChange({ ...filters, activeOnly: !filters.activeOnly });
  };

  const filterBtnClass = [
    'agents-filter-btn',
    filters.activeOnly ? 'agents-filter-btn--active' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="agents-toolbar">
      <div className="agents-search-box">
        <Search size={14} className="agents-search-icon" />
        <input
          type="text"
          className="agents-search-input"
          placeholder="Search agents…"
          value={filters.query}
          onChange={handleSearchChange}
        />
      </div>

      <button className={filterBtnClass} onClick={handleActiveFilterClick}>
        <CheckCircle size={13} />
        Active
        {activeCount > 0 && <span className="agents-filter-count">{activeCount}</span>}
      </button>

      <span className="agents-toolbar-count">{totalVisible} agents</span>
    </div>
  );
}
