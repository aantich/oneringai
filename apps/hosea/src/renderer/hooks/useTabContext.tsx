/**
 * TabContext - Multi-tab chat session management
 *
 * Manages multiple independent chat sessions (tabs), each with its own
 * agent instance, messages, and streaming state.
 */

import React, { useState, useCallback, createContext, useContext, useEffect, useRef } from 'react';
import type { IChatMessage, IToolCallInfo } from '@everworker/react-ui';
import type { Plan, StreamChunk, DynamicUIContent, ContextEntryForUI } from '../../preload/index';

// Sidebar tab type
export type SidebarTab = 'look_inside' | 'dynamic_ui' | 'routines';

// ============ Types ============

// Re-export shared types with Hosea-specific extensions
export type Message = IChatMessage & {
  /** Retry information if the response is being retried */
  retryInfo?: { attempt: number; maxAttempts: number };
  /** Non-fatal warning (e.g., response truncation) */
  warning?: string;
};
export type ToolCallInfo = IToolCallInfo;

export interface TabState {
  instanceId: string;
  agentConfigId: string;
  agentName: string;
  title: string;
  messages: Message[];
  streamingContent: string;
  streamingThinking: string;
  activeToolCalls: Map<string, IToolCallInfo>;
  activePlan: Plan | null;
  isLoading: boolean;
  status: {
    initialized: boolean;
    connector: string | null;
    model: string | null;
    mode: string | null;
  };
  createdAt: number;
  // Dynamic UI content for this tab
  dynamicUIContent: DynamicUIContent | null;
  hasDynamicUIUpdate: boolean;
  // In-context memory entries visible in UI
  contextEntries: ContextEntryForUI[];
  pinnedContextKeys: string[];
  // Browser user control handoff state
  userHasControl: { active: boolean; reason?: string } | null;
  // Voice/voiceover state
  voiceConfigured: boolean;
  voiceoverEnabled: boolean;
  sessionSaveEnabled: boolean;
  // Routine execution state (in-memory only, derived from StreamChunk events)
  routineExecution: {
    executionId: string;
    routineName: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    tasks: Map<string, { name: string; status: string; output?: string; error?: string }>;
    steps: Array<{ timestamp: number; taskName: string; type: string; data?: Record<string, unknown> }>;
  } | null;
}

// Sidebar state interface
export interface SidebarState {
  isOpen: boolean;
  activeTab: SidebarTab;
  width: number;
}

export interface TabContextValue {
  tabs: Map<string, TabState>;
  activeTabId: string | null;
  tabOrder: string[];

  // Tab management
  createTab: (agentConfigId: string, agentName?: string, title?: string) => Promise<string | null>;
  closeTab: (tabId: string) => Promise<void>;
  switchTab: (tabId: string) => void;
  getActiveTab: () => TabState | null;
  updateTabTitle: (tabId: string, title: string) => void;

  // Messaging (operates on active tab)
  sendMessage: (content: string) => Promise<void>;
  cancelStream: () => Promise<void>;

  // Sidebar state and controls
  sidebar: SidebarState;
  setSidebarOpen: (isOpen: boolean) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setSidebarWidth: (width: number) => void;

  // Dynamic UI
  clearDynamicUIUpdate: () => void;
  sendDynamicUIAction: (action: string, elementId?: string, value?: unknown) => void;
  pinContextKey: (key: string, pinned: boolean) => Promise<void>;

  // Voice
  toggleVoiceover: () => Promise<void>;

  // Session saving
  toggleSessionSave: () => Promise<void>;

  // Session history
  createTabFromSession: (agentConfigId: string, sessionId: string, oldInstanceId: string, agentName: string, title: string) => Promise<string | null>;

  // State helpers
  isMaxTabsReached: boolean;
  tabCount: number;
}

// ============ Context ============

const TabContext = createContext<TabContextValue | null>(null);

const MAX_TABS = 10;
const MAX_TITLE_LENGTH = 30;
const DEFAULT_SIDEBAR_WIDTH = 400;

// ============ Provider ============

interface TabProviderProps {
  children: React.ReactNode;
  defaultAgentConfigId?: string;
  defaultAgentName?: string;
}

export function TabProvider({ children, defaultAgentConfigId, defaultAgentName }: TabProviderProps): React.ReactElement {
  const [tabs, setTabs] = useState<Map<string, TabState>>(new Map());
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [tabOrder, setTabOrder] = useState<string[]>([]);

  // Sidebar state
  const [sidebar, setSidebar] = useState<SidebarState>({
    isOpen: false,
    activeTab: 'look_inside',
    width: DEFAULT_SIDEBAR_WIDTH,
  });

  // Track whether we've set up listeners
  const listenersSetup = useRef(false);

  // Set up instance-aware streaming listeners
  useEffect(() => {
    if (listenersSetup.current) return;
    listenersSetup.current = true;

    // Set up stream chunk handler
    window.hosea.agent.onStreamChunkInstance((instanceId: string, chunk: StreamChunk) => {
      // Voice events don't modify tab state — dispatch outside setTabs to avoid
      // React StrictMode double-invocation of the state updater
      if (chunk.type === 'voice:chunk') {
        window.dispatchEvent(new CustomEvent('hosea:voice-chunk', {
          detail: { instanceId, chunkIndex: chunk.chunkIndex, subIndex: chunk.subIndex, audioBase64: chunk.audioBase64, format: chunk.format, durationSeconds: chunk.durationSeconds, text: chunk.text },
        }));
        return;
      }
      if (chunk.type === 'voice:error') {
        window.dispatchEvent(new CustomEvent('hosea:voice-error', {
          detail: { instanceId, chunkIndex: chunk.chunkIndex, error: chunk.error, text: chunk.text },
        }));
        return;
      }
      if (chunk.type === 'voice:complete') {
        window.dispatchEvent(new CustomEvent('hosea:voice-complete', {
          detail: { instanceId, totalChunks: chunk.totalChunks, totalDurationSeconds: chunk.totalDurationSeconds },
        }));
        return;
      }

      setTabs(prevTabs => {
        // Direct lookup - Map key IS the instanceId
        const tab = prevTabs.get(instanceId);
        if (!tab) return prevTabs;

        const newTabs = new Map(prevTabs);
        const updatedTab = { ...tab };

        if (chunk.type === 'thinking' && chunk.content) {
          updatedTab.streamingThinking = (tab.streamingThinking || '') + chunk.content;

          // Update the streaming message's thinking field
          const lastMsg = updatedTab.messages[updatedTab.messages.length - 1];
          if (lastMsg?.isStreaming) {
            updatedTab.messages = [
              ...updatedTab.messages.slice(0, -1),
              { ...lastMsg, thinking: updatedTab.streamingThinking },
            ];
          }
        } else if (chunk.type === 'thinking_done') {
          const finalThinking = updatedTab.streamingThinking || chunk.content || '';
          const lastMsg = updatedTab.messages[updatedTab.messages.length - 1];
          if (lastMsg?.isStreaming) {
            updatedTab.messages = [
              ...updatedTab.messages.slice(0, -1),
              { ...lastMsg, thinking: finalThinking },
            ];
          }
          updatedTab.streamingThinking = '';
        } else if (chunk.type === 'text' && chunk.content) {
          updatedTab.streamingContent = tab.streamingContent + chunk.content;

          // Update the streaming message content
          const lastMsg = updatedTab.messages[updatedTab.messages.length - 1];
          if (lastMsg?.isStreaming) {
            updatedTab.messages = [
              ...updatedTab.messages.slice(0, -1),
              { ...lastMsg, content: updatedTab.streamingContent },
            ];
          }
        } else if (chunk.type === 'tool_start') {
          const toolCall: IToolCallInfo = {
            id: `${chunk.tool}-${Date.now()}`,
            name: chunk.tool,
            args: chunk.args,
            description: chunk.description,
            status: 'running',
          };

          updatedTab.activeToolCalls = new Map(tab.activeToolCalls);
          updatedTab.activeToolCalls.set(toolCall.id, toolCall);

          // Add tool call to the streaming message
          const lastMsg = updatedTab.messages[updatedTab.messages.length - 1];
          if (lastMsg?.isStreaming) {
            const existingToolCalls = lastMsg.toolCalls || [];
            updatedTab.messages = [
              ...updatedTab.messages.slice(0, -1),
              { ...lastMsg, toolCalls: [...existingToolCalls, toolCall] },
            ];
          }
        } else if (chunk.type === 'tool_end') {
          // Update tool call status to complete
          const lastMsg = updatedTab.messages[updatedTab.messages.length - 1];
          if (lastMsg?.isStreaming && lastMsg.toolCalls) {
            const updatedToolCalls = lastMsg.toolCalls.map(tc =>
              tc.name === chunk.tool && tc.status === 'running'
                ? { ...tc, status: 'complete' as const, durationMs: chunk.durationMs, result: chunk.result }
                : tc
            );
            updatedTab.messages = [
              ...updatedTab.messages.slice(0, -1),
              { ...lastMsg, toolCalls: updatedToolCalls },
            ];
          }
        } else if (chunk.type === 'tool_error') {
          const lastMsg = updatedTab.messages[updatedTab.messages.length - 1];
          if (lastMsg?.isStreaming && lastMsg.toolCalls) {
            const updatedToolCalls = lastMsg.toolCalls.map(tc =>
              tc.name === chunk.tool && tc.status === 'running'
                ? { ...tc, status: 'error' as const, error: chunk.error, result: chunk.result }
                : tc
            );
            updatedTab.messages = [
              ...updatedTab.messages.slice(0, -1),
              { ...lastMsg, toolCalls: updatedToolCalls },
            ];
          }
        }
        // Plan events
        else if (chunk.type === 'plan:created' || chunk.type === 'plan:awaiting_approval' || chunk.type === 'needs:approval') {
          const plan = (chunk as { plan: Plan }).plan;
          if (plan) {
            updatedTab.activePlan = plan;
          }
        } else if (chunk.type === 'plan:approved') {
          if (updatedTab.activePlan) {
            updatedTab.activePlan = { ...updatedTab.activePlan, status: 'running' };
          }
        }
        // Task events
        else if (chunk.type === 'task:started') {
          if (updatedTab.activePlan) {
            updatedTab.activePlan = {
              ...updatedTab.activePlan,
              tasks: updatedTab.activePlan.tasks.map(t =>
                t.id === chunk.task.id ? { ...t, status: 'in_progress', startedAt: chunk.task.startedAt } : t
              ),
            };
          }
        } else if (chunk.type === 'task:completed') {
          if (updatedTab.activePlan) {
            updatedTab.activePlan = {
              ...updatedTab.activePlan,
              tasks: updatedTab.activePlan.tasks.map(t =>
                t.id === chunk.task.id
                  ? { ...t, status: 'completed', completedAt: chunk.task.completedAt, result: chunk.task.result }
                  : t
              ),
            };
          }
        } else if (chunk.type === 'task:failed') {
          if (updatedTab.activePlan) {
            updatedTab.activePlan = {
              ...updatedTab.activePlan,
              tasks: updatedTab.activePlan.tasks.map(t =>
                t.id === chunk.task.id
                  ? { ...t, status: 'failed', result: { success: false, error: chunk.error } }
                  : t
              ),
            };
          }
        }
        // Execution events
        else if (chunk.type === 'execution:done') {
          if (updatedTab.activePlan) {
            const result = chunk.result as { status: string };
            updatedTab.activePlan = {
              ...updatedTab.activePlan,
              status: result.status === 'completed' ? 'completed' : 'failed',
              completedAt: Date.now(),
            };
          }
        }
        // Error events - display error to user
        else if (chunk.type === 'error') {
          const lastMsg = updatedTab.messages[updatedTab.messages.length - 1];
          if (lastMsg?.isStreaming) {
            updatedTab.messages = [
              ...updatedTab.messages.slice(0, -1),
              { ...lastMsg, error: chunk.content, isStreaming: false },
            ];
          }
          updatedTab.isLoading = false;
          updatedTab.streamingContent = '';
        }
        // Retry events - show retry indicator on the streaming message
        else if (chunk.type === 'retry') {
          const lastMsg = updatedTab.messages[updatedTab.messages.length - 1];
          if (lastMsg?.isStreaming) {
            updatedTab.messages = [
              ...updatedTab.messages.slice(0, -1),
              { ...lastMsg, retryInfo: { attempt: chunk.attempt, maxAttempts: chunk.maxAttempts } },
            ];
          }
        }
        // Status events - handle failed/incomplete responses
        else if (chunk.type === 'status') {
          const lastMsg = updatedTab.messages[updatedTab.messages.length - 1];
          if (lastMsg?.isStreaming) {
            if (chunk.status === 'failed') {
              const reason = chunk.stopReason === 'SAFETY' ? 'Content was blocked by safety filters.'
                : chunk.stopReason === 'RECITATION' ? 'Response blocked due to recitation policy.'
                : `Response failed (${chunk.stopReason || 'unknown reason'}).`;
              updatedTab.messages = [
                ...updatedTab.messages.slice(0, -1),
                { ...lastMsg, error: reason },
              ];
            } else if (chunk.status === 'incomplete') {
              updatedTab.messages = [
                ...updatedTab.messages.slice(0, -1),
                { ...lastMsg, warning: `Response was truncated (${chunk.stopReason || 'max tokens reached'}).` },
              ];
            }
          }
        }
        // UI control events
        else if (chunk.type === 'ui:show_sidebar') {
          setSidebar(prev => ({
            ...prev,
            isOpen: true,
            activeTab: chunk.tab || prev.activeTab,
          }));
        }
        else if (chunk.type === 'ui:hide_sidebar') {
          setSidebar(prev => ({ ...prev, isOpen: false }));
        }
        else if (chunk.type === 'ui:set_dynamic_content') {
          updatedTab.dynamicUIContent = chunk.content;
          updatedTab.hasDynamicUIUpdate = true;
          // Auto-open sidebar and switch to dynamic UI tab
          setSidebar(prev => ({
            ...prev,
            isOpen: true,
            activeTab: 'dynamic_ui',
          }));
        }
        else if (chunk.type === 'ui:clear_dynamic_content') {
          updatedTab.dynamicUIContent = null;
          updatedTab.hasDynamicUIUpdate = false;
        }
        // In-context memory entries update
        else if (chunk.type === 'ui:context_entries') {
          updatedTab.contextEntries = chunk.entries;
          updatedTab.pinnedContextKeys = chunk.pinnedKeys;
          // Show notification dot if sidebar not showing dynamic_ui
          updatedTab.hasDynamicUIUpdate = true;
        }
        // Routine execution events
        else if (chunk.type === 'routine:started') {
          updatedTab.routineExecution = {
            executionId: chunk.executionId,
            routineName: chunk.routineName,
            status: 'running',
            progress: 0,
            tasks: new Map(),
            steps: [],
          };
          // Auto-open sidebar and switch to routines tab
          setSidebar(prev => ({ ...prev, isOpen: true, activeTab: 'routines' }));
        }
        else if (chunk.type === 'routine:task_started' && updatedTab.routineExecution) {
          const tasks = new Map(updatedTab.routineExecution.tasks);
          tasks.set(chunk.taskId, { name: chunk.taskName, status: 'running' });
          updatedTab.routineExecution = { ...updatedTab.routineExecution, tasks };
        }
        else if (chunk.type === 'routine:task_completed' && updatedTab.routineExecution) {
          const tasks = new Map(updatedTab.routineExecution.tasks);
          tasks.set(chunk.taskId, { name: chunk.taskName, status: 'completed', output: chunk.output });
          updatedTab.routineExecution = { ...updatedTab.routineExecution, tasks, progress: chunk.progress };
        }
        else if (chunk.type === 'routine:task_failed' && updatedTab.routineExecution) {
          const tasks = new Map(updatedTab.routineExecution.tasks);
          tasks.set(chunk.taskId, { name: chunk.taskName, status: 'failed', error: chunk.error });
          updatedTab.routineExecution = { ...updatedTab.routineExecution, tasks, progress: chunk.progress };
        }
        else if (chunk.type === 'routine:step' && updatedTab.routineExecution) {
          updatedTab.routineExecution = {
            ...updatedTab.routineExecution,
            steps: [...updatedTab.routineExecution.steps, chunk.step],
          };
        }
        else if (chunk.type === 'routine:completed' && updatedTab.routineExecution) {
          updatedTab.routineExecution = { ...updatedTab.routineExecution, status: 'completed', progress: chunk.progress };
        }
        else if (chunk.type === 'routine:failed' && updatedTab.routineExecution) {
          updatedTab.routineExecution = { ...updatedTab.routineExecution, status: 'failed' };
        }
        // Browser user control handoff events
        else if (chunk.type === 'browser:user_has_control') {
          updatedTab.userHasControl = { active: true, reason: chunk.reason };
          // Add a system message explaining what happened
          const systemMsg: Message = {
            id: `system-control-${Date.now()}`,
            role: 'assistant',
            content: `**Agent paused** — ${chunk.reason || 'User took manual control of the browser.'}\n\nUse the browser to resolve the issue, then click **Hand Back to Agent** to continue.`,
            timestamp: Date.now(),
          };
          updatedTab.messages = [...updatedTab.messages, systemMsg];
        }
        else if (chunk.type === 'browser:agent_has_control') {
          updatedTab.userHasControl = null;
        }

        newTabs.set(tab.instanceId, updatedTab);
        return newTabs;
      });
    });

    // Set up stream end handler
    window.hosea.agent.onStreamEndInstance((instanceId: string) => {
      setTabs(prevTabs => {
        // Direct lookup - Map key IS the instanceId
        const tab = prevTabs.get(instanceId);
        if (!tab) return prevTabs;

        const newTabs = new Map(prevTabs);
        const updatedTab = { ...tab };

        // Finalize the streaming message - ALWAYS mark as not streaming
        const lastMsg = updatedTab.messages[updatedTab.messages.length - 1];
        if (lastMsg?.isStreaming) {
          // Use streaming content if available, otherwise keep existing content
          const finalContent = updatedTab.streamingContent || lastMsg.content || '';
          updatedTab.messages = [
            ...updatedTab.messages.slice(0, -1),
            { ...lastMsg, content: finalContent, isStreaming: false },
          ];
        }

        updatedTab.streamingContent = '';
        updatedTab.streamingThinking = '';
        updatedTab.activeToolCalls = new Map();
        updatedTab.isLoading = false;
        updatedTab.userHasControl = null;

        newTabs.set(tab.instanceId, updatedTab);
        return newTabs;
      });
    });

    return () => {
      window.hosea.agent.removeStreamInstanceListeners();
      listenersSetup.current = false;
    };
  }, []);

  // Create a new tab
  const createTab = useCallback(async (agentConfigId: string, agentName?: string, title?: string): Promise<string | null> => {
    if (tabs.size >= MAX_TABS) {
      console.warn(`Maximum number of tabs (${MAX_TABS}) reached`);
      return null;
    }

    try {
      // Create the agent instance
      const result = await window.hosea.agent.createInstance(agentConfigId);
      if (!result.success || !result.instanceId) {
        console.error('Failed to create instance:', result.error);
        return null;
      }

      const instanceId = result.instanceId;
      const tabTitle = title
        ? title.slice(0, MAX_TITLE_LENGTH)
        : (agentName || 'New Chat').slice(0, MAX_TITLE_LENGTH);

      // Create tab state
      const newTab: TabState = {
        instanceId,
        agentConfigId,
        agentName: agentName || 'Assistant',
        title: tabTitle,
        messages: [],
        streamingContent: '',
        streamingThinking: '',
        activeToolCalls: new Map(),
        activePlan: null,
        isLoading: false,
        status: {
          initialized: true,
          connector: null,
          model: null,
          mode: null,
        },
        createdAt: Date.now(),
        dynamicUIContent: null,
        hasDynamicUIUpdate: false,
        contextEntries: [],
        pinnedContextKeys: [],
        userHasControl: null,
        voiceConfigured: false,
        voiceoverEnabled: false,
        sessionSaveEnabled: false,
        routineExecution: null,
      };

      // Update status from instance
      const statusResult = await window.hosea.agent.statusInstance(instanceId);
      if (statusResult.found) {
        newTab.status = {
          initialized: statusResult.initialized,
          connector: statusResult.connector,
          model: statusResult.model,
          mode: statusResult.mode,
        };
      }

      // Add tab to state FIRST, then load async data that updates it
      setTabs(prev => {
        const newTabs = new Map(prev);
        newTabs.set(instanceId, newTab);
        return newTabs;
      });

      // Load voice config for this agent (tab must be in map before these run)
      window.hosea.agent.getVoiceConfig(agentConfigId).then(voiceConfig => {
        if (voiceConfig?.voiceEnabled) {
          setTabs(prev => {
            const tab = prev.get(instanceId);
            if (!tab) return prev;
            const newTabs = new Map(prev);
            newTabs.set(instanceId, { ...tab, voiceConfigured: true });
            return newTabs;
          });
        }
      }).catch(() => { /* ignore errors loading voice config */ });

      // Load pinned context keys for this agent
      window.hosea.agent.getPinnedContextKeys(agentConfigId).then(pinnedKeys => {
        setTabs(prev => {
          const tab = prev.get(instanceId);
          if (!tab) return prev;
          const newTabs = new Map(prev);
          newTabs.set(instanceId, { ...tab, pinnedContextKeys: pinnedKeys });
          return newTabs;
        });
      }).catch(() => { /* ignore errors loading pinned keys */ });

      setTabOrder(prev => [...prev, instanceId]);
      setActiveTabId(instanceId);

      return instanceId;
    } catch (error) {
      console.error('Error creating tab:', error);
      return null;
    }
  }, [tabs.size]);

  // Create a tab from a saved session (resume)
  const createTabFromSession = useCallback(async (
    agentConfigId: string,
    sessionId: string,
    oldInstanceId: string,
    agentName: string,
    title: string,
  ): Promise<string | null> => {
    if (tabs.size >= MAX_TABS) {
      console.warn(`Maximum number of tabs (${MAX_TABS}) reached`);
      return null;
    }

    try {
      const result = await window.hosea.history.resume(agentConfigId, sessionId, oldInstanceId);
      if (!result.success || !result.instanceId) {
        console.error('Failed to resume session:', result.error);
        return null;
      }

      const instanceId = result.instanceId;

      // Convert restored messages to UI format
      const restoredMessages: Message[] = (result.messages || []).map(m => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: m.timestamp,
      }));

      const newTab: TabState = {
        instanceId,
        agentConfigId,
        agentName,
        title: title.slice(0, MAX_TITLE_LENGTH),
        messages: restoredMessages,
        streamingContent: '',
        streamingThinking: '',
        activeToolCalls: new Map(),
        activePlan: null,
        isLoading: false,
        status: { initialized: true, connector: null, model: null, mode: null },
        createdAt: Date.now(),
        dynamicUIContent: null,
        hasDynamicUIUpdate: false,
        contextEntries: [],
        pinnedContextKeys: [],
        userHasControl: null,
        voiceConfigured: false,
        voiceoverEnabled: false,
        sessionSaveEnabled: true,
        routineExecution: null,
      };

      // Fetch actual status
      window.hosea.agent.statusInstance(instanceId).then(statusResult => {
        if (statusResult.found) {
          setTabs(prev => {
            const tab = prev.get(instanceId);
            if (!tab) return prev;
            const newTabs = new Map(prev);
            newTabs.set(instanceId, {
              ...tab,
              status: {
                initialized: statusResult.initialized,
                connector: statusResult.connector,
                model: statusResult.model,
                mode: statusResult.mode,
              },
            });
            return newTabs;
          });
        }
      }).catch(() => { /* ignore */ });

      // Load voice config
      window.hosea.agent.getVoiceConfig(agentConfigId).then(voiceConfig => {
        setTabs(prev => {
          const tab = prev.get(instanceId);
          if (!tab) return prev;
          const newTabs = new Map(prev);
          newTabs.set(instanceId, { ...tab, voiceConfigured: voiceConfig?.voiceEnabled ?? false });
          return newTabs;
        });
      }).catch(() => { /* ignore */ });

      // Load pinned context keys
      window.hosea.agent.getPinnedContextKeys(agentConfigId).then(pinnedKeys => {
        setTabs(prev => {
          const tab = prev.get(instanceId);
          if (!tab) return prev;
          const newTabs = new Map(prev);
          newTabs.set(instanceId, { ...tab, pinnedContextKeys: pinnedKeys });
          return newTabs;
        });
      }).catch(() => { /* ignore */ });

      setTabs(prev => {
        const newTabs = new Map(prev);
        newTabs.set(instanceId, newTab);
        return newTabs;
      });
      setTabOrder(prev => [...prev, instanceId]);
      setActiveTabId(instanceId);

      return instanceId;
    } catch (error) {
      console.error('Error resuming session:', error);
      return null;
    }
  }, [tabs.size]);

  // Close a tab
  const closeTab = useCallback(async (tabId: string): Promise<void> => {
    const tab = tabs.get(tabId);
    if (!tab) return;

    try {
      // Cancel any ongoing stream
      if (tab.isLoading) {
        await window.hosea.agent.cancelInstance(tab.instanceId);
      }

      // Destroy the instance
      await window.hosea.agent.destroyInstance(tab.instanceId);
    } catch (error) {
      console.error('Error destroying instance:', error);
    }

    // Remove from state
    setTabs(prev => {
      const newTabs = new Map(prev);
      newTabs.delete(tabId);
      return newTabs;
    });

    setTabOrder(prev => prev.filter(id => id !== tabId));

    // If closing active tab, switch to another
    if (activeTabId === tabId) {
      const remainingTabs = tabOrder.filter(id => id !== tabId);
      const newActiveId = remainingTabs.length > 0 ? remainingTabs[remainingTabs.length - 1] : null;
      setActiveTabId(newActiveId);
    }
  }, [tabs, tabOrder, activeTabId]);

  // Switch to a tab
  const switchTab = useCallback((tabId: string): void => {
    if (tabs.has(tabId)) {
      setActiveTabId(tabId);
    }
  }, [tabs]);

  // Get active tab
  const getActiveTab = useCallback((): TabState | null => {
    if (!activeTabId) return null;
    return tabs.get(activeTabId) || null;
  }, [activeTabId, tabs]);

  // Update tab title
  const updateTabTitle = useCallback((tabId: string, title: string): void => {
    setTabs(prev => {
      const tab = prev.get(tabId);
      if (!tab) return prev;

      const newTabs = new Map(prev);
      newTabs.set(tabId, {
        ...tab,
        title: title.slice(0, MAX_TITLE_LENGTH),
      });
      return newTabs;
    });
  }, []);

  // Send a message to the active tab
  const sendMessage = useCallback(async (content: string): Promise<void> => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (!tab || tab.isLoading) return;

    // Add user message
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    // Add placeholder for assistant response
    const assistantMessage: Message = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    };

    setTabs(prev => {
      const newTabs = new Map(prev);
      const updatedTab = {
        ...tab,
        messages: [...tab.messages, userMessage, assistantMessage],
        isLoading: true,
        streamingContent: '',
      };
      newTabs.set(tab.instanceId, updatedTab);
      return newTabs;
    });

    // Start streaming
    await window.hosea.agent.streamInstance(tab.instanceId, content);
  }, [activeTabId, tabs]);

  // Cancel the stream for active tab
  const cancelStream = useCallback(async (): Promise<void> => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (!tab) return;

    await window.hosea.agent.cancelInstance(tab.instanceId);

    setTabs(prev => {
      const newTabs = new Map(prev);
      const updatedTab = {
        ...tab,
        isLoading: false,
      };
      newTabs.set(tab.instanceId, updatedTab);
      return newTabs;
    });
  }, [activeTabId, tabs]);

  // Create default tab on mount if no tabs exist
  useEffect(() => {
    if (tabs.size === 0 && defaultAgentConfigId) {
      createTab(defaultAgentConfigId, defaultAgentName, 'Chat');
    }
  }, [defaultAgentConfigId, defaultAgentName, createTab, tabs.size]);

  // Sidebar controls
  const setSidebarOpen = useCallback((isOpen: boolean) => {
    setSidebar(prev => ({ ...prev, isOpen }));
  }, []);

  const setSidebarTab = useCallback((activeTab: SidebarTab) => {
    setSidebar(prev => ({ ...prev, activeTab }));
    // Clear update indicator when switching to dynamic UI tab
    if (activeTab === 'dynamic_ui' && activeTabId) {
      setTabs(prevTabs => {
        const tab = prevTabs.get(activeTabId);
        if (tab && tab.hasDynamicUIUpdate) {
          const newTabs = new Map(prevTabs);
          newTabs.set(activeTabId, { ...tab, hasDynamicUIUpdate: false });
          return newTabs;
        }
        return prevTabs;
      });
    }
  }, [activeTabId]);

  const setSidebarWidth = useCallback((width: number) => {
    setSidebar(prev => ({ ...prev, width }));
  }, []);

  // Clear dynamic UI update indicator
  const clearDynamicUIUpdate = useCallback(() => {
    if (!activeTabId) return;
    setTabs(prevTabs => {
      const tab = prevTabs.get(activeTabId);
      if (tab && tab.hasDynamicUIUpdate) {
        const newTabs = new Map(prevTabs);
        newTabs.set(activeTabId, { ...tab, hasDynamicUIUpdate: false });
        return newTabs;
      }
      return prevTabs;
    });
  }, [activeTabId]);

  // Send action back to agent for dynamic UI interactions
  const sendDynamicUIAction = useCallback((action: string, elementId?: string, value?: unknown) => {
    // Send as a special message that the agent can interpret
    const actionMessage = JSON.stringify({ action, elementId, value });
    sendMessage(`[UI Action] ${actionMessage}`);
  }, [sendMessage]);

  // Pin/unpin a context key for the active tab's agent
  const pinContextKey = useCallback(async (key: string, pinned: boolean): Promise<void> => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (!tab) return;

    // Optimistic update
    setTabs(prevTabs => {
      const currentTab = prevTabs.get(tab.instanceId);
      if (!currentTab) return prevTabs;
      const newTabs = new Map(prevTabs);
      const updatedPinned = pinned
        ? [...currentTab.pinnedContextKeys.filter(k => k !== key), key]
        : currentTab.pinnedContextKeys.filter(k => k !== key);
      newTabs.set(tab.instanceId, { ...currentTab, pinnedContextKeys: updatedPinned });
      return newTabs;
    });

    // Persist to disk (also triggers re-emission of entries with updated pinnedKeys)
    await window.hosea.agent.pinContextKey(tab.agentConfigId, key, pinned);
  }, [activeTabId, tabs]);

  // Toggle voiceover for the active tab
  const toggleVoiceover = useCallback(async (): Promise<void> => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (!tab || !tab.voiceConfigured) return;

    const newEnabled = !tab.voiceoverEnabled;
    const result = await window.hosea.agent.setVoiceover(tab.instanceId, newEnabled);
    if (result.success) {
      setTabs(prev => {
        const currentTab = prev.get(tab.instanceId);
        if (!currentTab) return prev;
        const newTabs = new Map(prev);
        newTabs.set(tab.instanceId, { ...currentTab, voiceoverEnabled: newEnabled });
        return newTabs;
      });
    } else {
      console.error('Failed to toggle voiceover:', result.error);
    }
  }, [activeTabId, tabs]);

  const toggleSessionSave = useCallback(async (): Promise<void> => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (!tab) return;

    const newEnabled = !tab.sessionSaveEnabled;
    const result = await window.hosea.agent.setSessionSave(tab.instanceId, newEnabled);
    if (result.success) {
      setTabs(prev => {
        const currentTab = prev.get(tab.instanceId);
        if (!currentTab) return prev;
        const newTabs = new Map(prev);
        newTabs.set(tab.instanceId, { ...currentTab, sessionSaveEnabled: newEnabled });
        return newTabs;
      });
    } else {
      console.error('Failed to toggle session save:', result.error);
    }
  }, [activeTabId, tabs]);

  const value: TabContextValue = {
    tabs,
    activeTabId,
    tabOrder,
    createTab,
    closeTab,
    switchTab,
    getActiveTab,
    updateTabTitle,
    sendMessage,
    cancelStream,
    // Sidebar
    sidebar,
    setSidebarOpen,
    setSidebarTab,
    setSidebarWidth,
    // Dynamic UI
    clearDynamicUIUpdate,
    sendDynamicUIAction,
    pinContextKey,
    // Voice
    toggleVoiceover,
    // Session saving
    toggleSessionSave,
    // Session history
    createTabFromSession,
    isMaxTabsReached: tabs.size >= MAX_TABS,
    tabCount: tabs.size,
  };

  return (
    <TabContext.Provider value={value}>
      {children}
    </TabContext.Provider>
  );
}

// ============ Hook ============

export function useTabContext(): TabContextValue {
  const context = useContext(TabContext);
  if (!context) {
    throw new Error('useTabContext must be used within TabProvider');
  }
  return context;
}

export { TabContext };
