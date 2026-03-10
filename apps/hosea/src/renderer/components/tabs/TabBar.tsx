/**
 * TabBar - Horizontal tab bar for managing multiple chat sessions
 * Includes toolbar actions on the right side
 */

import React from 'react';
import { Plus, PanelRightOpen, PanelRightClose, Volume2, VolumeX } from 'lucide-react';
import { Tab } from './Tab';
import { useTabContext } from '../../hooks/useTabContext';

interface TabBarProps {
  onNewTabClick: () => void;
  showInternals: boolean;
  onToggleInternals: () => void;
}

export function TabBar({ onNewTabClick, showInternals, onToggleInternals }: TabBarProps): React.ReactElement {
  const { tabs, activeTabId, tabOrder, switchTab, closeTab, isMaxTabsReached, toggleVoiceover } = useTabContext();
  const activeTab = activeTabId ? tabs.get(activeTabId) : null;

  return (
    <div className="chat-tabs">
      {/* Tabs list */}
      <div className="chat-tabs__list">
        {tabOrder.map(tabId => {
          const tab = tabs.get(tabId);
          if (!tab) return null;

          return (
            <Tab
              key={tabId}
              id={tabId}
              title={tab.title}
              agentName={tab.agentName}
              isActive={tabId === activeTabId}
              isLoading={tab.isLoading}
              onClick={() => switchTab(tabId)}
              onClose={() => closeTab(tabId)}
            />
          );
        })}
      </div>

      {/* Toolbar actions */}
      <div className="chat-tabs__actions">
        <button
          type="button"
          className="chat-tabs__add"
          onClick={onNewTabClick}
          disabled={isMaxTabsReached}
          title={isMaxTabsReached ? 'Maximum tabs reached' : 'New tab'}
        >
          <Plus size={16} />
        </button>

        {activeTab?.voiceConfigured && (
          <button
            type="button"
            className={`chat-tabs__action ${activeTab.voiceoverEnabled ? 'chat-tabs__action--active' : ''}`}
            onClick={toggleVoiceover}
            title={activeTab.voiceoverEnabled ? 'Turn off voiceover' : 'Turn on voiceover'}
          >
            {activeTab.voiceoverEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
        )}

        <button
          type="button"
          className={`chat-tabs__action ${showInternals ? 'chat-tabs__action--active' : ''}`}
          onClick={onToggleInternals}
          title={showInternals ? 'Hide sidebar panel' : 'Show sidebar panel'}
        >
          {showInternals ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
        </button>
      </div>
    </div>
  );
}
