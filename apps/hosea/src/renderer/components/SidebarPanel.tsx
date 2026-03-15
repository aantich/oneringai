/**
 * SidebarPanel - Tabbed sidebar panel with "Look Inside" and "Dynamic UI" tabs
 * Supports resizing up to nearly full screen width
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Zap, Layout, ListChecks, Users } from 'lucide-react';
import { useDynamicUIChangeDetection } from '@everworker/react-ui';
import type { InContextEntry } from '@everworker/oneringai';
import { InternalsContent } from './InternalsContent';
import { DynamicUIPanel } from './DynamicUIPanel';
import { ContextDisplayPanel } from './ContextDisplayPanel';
import { RoutinesPanel } from './RoutinesPanel';
import { WorkerInspectorPanel, WorkspaceView } from './orchestrator';
import type { DynamicUIContent, ContextEntryForUI } from '../../preload/index';
import type { SidebarTab, TabState, WorkerState } from '../hooks/useTabContext';

interface SidebarPanelProps {
  isOpen: boolean;
  onClose: () => void;
  width: number;
  onWidthChange: (width: number) => void;
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  /** Optional instanceId for multi-tab support. If null, uses legacy single agent. */
  instanceId?: string | null;
  /** Dynamic UI content to render */
  dynamicUIContent: DynamicUIContent | null;
  /** Whether Dynamic UI has new content (for notification dot) */
  hasDynamicUIUpdate?: boolean;
  /** Callback when dynamic UI action is triggered */
  onDynamicUIAction?: (action: string, elementId?: string, value?: unknown) => void;
  /** In-context memory entries for Current Context display */
  contextEntries?: ContextEntryForUI[];
  /** User-pinned context keys */
  pinnedContextKeys?: string[];
  /** Callback when user pins/unpins a context key */
  onPinContextKey?: (key: string, pinned: boolean) => void;
  /** Routine execution state for Routines tab */
  routineExecution?: TabState['routineExecution'];
  /** Browser user control handoff state */
  userHasControl?: TabState['userHasControl'];
  /** Whether this tab is an orchestrator */
  isOrchestrator?: boolean;
  /** Orchestrator worker states */
  workers?: Map<string, WorkerState>;
  /** Currently selected worker for inspection */
  selectedWorkerName?: string | null;
  /** Callback to select/deselect a worker */
  onSelectWorker?: (name: string | null) => void;
  /** Shared workspace entries */
  workspaceEntries?: TabState['workspaceEntries'];
}

const MIN_WIDTH = 280;
const DEFAULT_WIDTH = 400;

// Calculate max width dynamically (leave 200px for main content)
const getMaxWidth = () => typeof window !== 'undefined' ? window.innerWidth - 200 : 1200;

export function SidebarPanel({
  isOpen,
  onClose,
  width,
  onWidthChange,
  activeTab,
  onTabChange,
  instanceId,
  dynamicUIContent,
  hasDynamicUIUpdate,
  onDynamicUIAction,
  contextEntries,
  pinnedContextKeys,
  onPinContextKey,
  routineExecution,
  userHasControl,
  isOrchestrator,
  workers,
  selectedWorkerName,
  onSelectWorker,
  workspaceEntries,
}: SidebarPanelProps): React.ReactElement | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const [maxWidth, setMaxWidth] = useState(getMaxWidth);

  // Update max width on window resize
  useEffect(() => {
    const handleResize = () => {
      const newMaxWidth = getMaxWidth();
      setMaxWidth(newMaxWidth);
      // Clamp current width if it exceeds new max
      if (width > newMaxWidth) {
        onWidthChange(newMaxWidth);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [width, onWidthChange]);

  // Handle resize drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;

      const newWidth = window.innerWidth - e.clientX;
      const currentMaxWidth = getMaxWidth();
      const clampedWidth = Math.min(currentMaxWidth, Math.max(MIN_WIDTH, newWidth));
      onWidthChange(clampedWidth);
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onWidthChange]);

  const [contextMaximized, setContextMaximized] = useState(false);

  // Highlight detection: flash entry card when value changes
  const highlightKey = useDynamicUIChangeDetection(
    (contextEntries ?? []) as unknown as InContextEntry[],
  );

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className="sidebar-panel"
      style={{ width: `${width}px` }}
    >
      {/* Resize handle */}
      <div
        className="sidebar-panel__resize-handle"
        onMouseDown={handleMouseDown}
      />

      {/* Header with tabs */}
      <div className="sidebar-panel__header">
        <div className="sidebar-panel__tabs">
          <button
            className={`sidebar-panel__tab ${activeTab === 'look_inside' ? 'sidebar-panel__tab--active' : ''}`}
            onClick={() => onTabChange('look_inside')}
          >
            <Zap size={14} />
            <span>Look Inside</span>
          </button>
          <button
            className={`sidebar-panel__tab ${activeTab === 'dynamic_ui' ? 'sidebar-panel__tab--active' : ''}`}
            onClick={() => onTabChange('dynamic_ui')}
          >
            <Layout size={14} />
            <span>Dynamic UI</span>
            {hasDynamicUIUpdate && activeTab !== 'dynamic_ui' && (
              <span className="sidebar-panel__notification-dot" />
            )}
          </button>
          <button
            className={`sidebar-panel__tab ${activeTab === 'routines' ? 'sidebar-panel__tab--active' : ''}`}
            onClick={() => onTabChange('routines')}
          >
            <ListChecks size={14} />
            <span>Routines</span>
            {routineExecution?.status === 'running' && activeTab !== 'routines' && (
              <span className="sidebar-panel__notification-dot" />
            )}
          </button>
          {isOrchestrator && (
            <button
              className={`sidebar-panel__tab ${activeTab === 'workers' ? 'sidebar-panel__tab--active' : ''}`}
              onClick={() => onTabChange('workers')}
            >
              <Users size={14} />
              <span>Workers</span>
              {workers && workers.size > 0 && activeTab !== 'workers' && (
                <span className="sidebar-panel__notification-dot" />
              )}
            </button>
          )}
        </div>
        <button
          className="sidebar-panel__close-btn"
          onClick={onClose}
          title="Close panel"
        >
          <X size={16} />
        </button>
      </div>

      {/* Tab content */}
      <div className="sidebar-panel__content">
        {activeTab === 'workers' && isOrchestrator ? (
          selectedWorkerName && workers?.get(selectedWorkerName) ? (
            <WorkerInspectorPanel
              instanceId={instanceId ?? ''}
              worker={workers.get(selectedWorkerName)!}
              onBack={() => onSelectWorker?.(null)}
            />
          ) : (
            <WorkspaceView entries={workspaceEntries ?? []} />
          )
        ) : activeTab === 'look_inside' ? (
          <InternalsContent instanceId={instanceId} />
        ) : activeTab === 'routines' ? (
          <RoutinesPanel
            instanceId={instanceId}
            routineExecution={routineExecution}
          />
        ) : (
          <>
            {contextEntries && pinnedContextKeys && onPinContextKey && (
              <ContextDisplayPanel
                entries={contextEntries}
                highlightKey={highlightKey}
                pinnedKeys={pinnedContextKeys}
                onPinToggle={onPinContextKey}
                onMaximizedChange={setContextMaximized}
              />
            )}
            {!contextMaximized && (
              <DynamicUIPanel
                content={dynamicUIContent}
                onAction={onDynamicUIAction}
                userHasControl={userHasControl}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export { DEFAULT_WIDTH as SIDEBAR_PANEL_DEFAULT_WIDTH };
