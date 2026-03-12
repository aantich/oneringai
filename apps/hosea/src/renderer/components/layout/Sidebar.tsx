/**
 * Sidebar Navigation Component
 */

import React, { useState, useEffect } from 'react';
import {
  MessageSquare,
  Bot,
  Brain,
  Settings,
  PanelLeftClose,
  PanelLeft,
  Key,
  Wrench,
  Palette,
  Server,
  ListChecks,
  Plug,
  ChevronDown,
  ChevronRight,
  History,
} from 'lucide-react';
import { useNavigation, type PageId } from '../../hooks/useNavigation';
import logoFull from '../../assets/logo-full.svg';
import logoShort from '../../assets/logo-short.svg';

interface NavItem {
  id: PageId;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const ADVANCED_COLLAPSED_KEY = 'hosea:sidebar:advancedCollapsed';

const mainSections: NavSection[] = [
  {
    label: 'Main',
    items: [
      { id: 'chat', label: 'Chat', icon: <MessageSquare size={20} /> },
      { id: 'history', label: 'History', icon: <History size={20} /> },
      { id: 'agents', label: 'Agents', icon: <Bot size={20} /> },
      { id: 'routines', label: 'Routines', icon: <ListChecks size={20} /> },
    ],
  },
  {
    label: 'Creation',
    items: [
      { id: 'multimedia-studio', label: 'Multimedia Studio', icon: <Palette size={20} /> },
    ],
  },
  {
    label: 'Connections',
    items: [
      { id: 'connections', label: 'Connections', icon: <Plug size={20} /> },
    ],
  },
];

const advancedItems: NavItem[] = [
  { id: 'llm-connectors', label: 'LLM Providers', icon: <Brain size={20} /> },
  { id: 'universal-connectors', label: 'Universal Connectors', icon: <Key size={20} /> },
  { id: 'tool-connectors', label: 'Tool Catalog', icon: <Wrench size={20} /> },
  { id: 'mcp-servers', label: 'MCP Servers', icon: <Server size={20} /> },
];

export function Sidebar(): React.ReactElement {
  const [expanded, setExpanded] = useState(true);
  const { state, navigate } = useNavigation();
  const [advancedCollapsed, setAdvancedCollapsed] = useState(() => {
    try {
      return localStorage.getItem(ADVANCED_COLLAPSED_KEY) !== 'false';
    } catch {
      return true;
    }
  });

  // Auto-expand advanced section if user navigates to an advanced page
  useEffect(() => {
    const advancedIds = advancedItems.map(i => i.id);
    if (advancedIds.includes(state.currentPage)) {
      setAdvancedCollapsed(false);
    }
  }, [state.currentPage]);

  const toggleAdvanced = () => {
    const next = !advancedCollapsed;
    setAdvancedCollapsed(next);
    try {
      localStorage.setItem(ADVANCED_COLLAPSED_KEY, String(next));
    } catch {
      // ignore
    }
  };

  const renderNavItem = (item: NavItem) => (
    <button
      key={item.id}
      className={`sidebar__item ${
        state.currentPage === item.id ? 'sidebar__item--active' : ''
      }`}
      onClick={() => navigate(item.id)}
      type="button"
      title={!expanded ? item.label : undefined}
    >
      <span className="sidebar__item-icon">{item.icon}</span>
      {expanded && (
        <>
          <span className="sidebar__item-text">{item.label}</span>
          {item.badge !== undefined && (
            <span className="sidebar__item-badge">{item.badge}</span>
          )}
        </>
      )}
      {!expanded && <span className="sidebar__tooltip">{item.label}</span>}
    </button>
  );

  return (
    <aside className={`sidebar ${expanded ? 'sidebar--expanded' : 'sidebar--collapsed'}`}>
      {/* macOS drag region for window dragging */}
      <div className="sidebar__drag-region" />

      {/* Brand */}
      <div className="sidebar__brand" onClick={() => setExpanded(!expanded)}>
        {expanded ? (
          <img src={logoFull} alt="Logo" className="sidebar__logo-full" />
        ) : (
          <img src={logoShort} alt="Logo" className="sidebar__logo-short" />
        )}
        <button
          className="sidebar__toggle"
          type="button"
          aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {expanded ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="sidebar__nav">
        {/* Main sections */}
        {mainSections.map((section) => (
          <div key={section.label} className="sidebar__section">
            {expanded && <div className="sidebar__section-label">{section.label}</div>}
            {section.items.map(renderNavItem)}
          </div>
        ))}

        {/* Advanced section (collapsible) */}
        <div className="sidebar__section">
          {expanded ? (
            <button
              className="sidebar__section-label sidebar__section-label--collapsible"
              onClick={toggleAdvanced}
              type="button"
            >
              <span>Advanced</span>
              {advancedCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          ) : (
            <div className="sidebar__divider" />
          )}
          {(!advancedCollapsed || !expanded) && advancedItems.map(renderNavItem)}
        </div>
      </nav>

      {/* Footer */}
      <div className="sidebar__footer">
        <button
          className={`sidebar__item ${
            state.currentPage === 'settings' ? 'sidebar__item--active' : ''
          }`}
          onClick={() => navigate('settings')}
          type="button"
          title={!expanded ? 'Settings' : undefined}
        >
          <span className="sidebar__item-icon">
            <Settings size={20} />
          </span>
          {expanded && <span className="sidebar__item-text">Settings</span>}
          {!expanded && <span className="sidebar__tooltip">Settings</span>}
        </button>
      </div>
    </aside>
  );
}
