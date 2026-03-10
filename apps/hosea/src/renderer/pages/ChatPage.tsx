/**
 * Chat Page - Main chat interface with multi-tab support
 * Features rich markdown rendering with support for code, diagrams, charts, and math
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Alert, Button, Spinner } from 'react-bootstrap';
import { Send, Square, Bot, User, Copy, Share, AlertCircle } from 'lucide-react';
import {
  MessageList,
  ExecutionProgress,
  MarkdownRenderer,
  ThinkingBlock,
  ToolCallCard,
  type IChatMessage,
} from '@everworker/react-ui';
import { SidebarPanel, SIDEBAR_PANEL_DEFAULT_WIDTH } from '../components/SidebarPanel';
import { PlanDisplay } from '../components/plan';
import { TabBar, NewTabModal } from '../components/tabs';
import { useTabContext, type Message, type TabState, type SidebarTab } from '../hooks/useTabContext';
import { useVoiceoverPlayback } from '../hooks/useVoiceoverPlayback';
import type { Plan } from '../../preload/index';
import { useNavigation } from '../hooks/useNavigation';

// ============ Chat Content Component (for active tab) ============

interface ChatContentProps {
  tab: TabState;
  onSend: (content: string) => void;
  onCancel: () => void;
}

function ChatContent({ tab, onSend, onCancel }: ChatContentProps): React.ReactElement {
  const { navigate } = useNavigation();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [planLoading, setPlanLoading] = useState<'approving' | 'rejecting' | null>(null);
  const [userHasScrolled, setUserHasScrolled] = useState(false);
  const lastMessageCount = useRef(tab.messages.length);

  // Scroll to bottom of messages container (NOT using scrollIntoView which affects parents)
  const scrollToBottom = useCallback((smooth = true) => {
    const container = messagesContainerRef.current;
    if (!container) return;

    if (smooth) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth'
      });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  // Check if user is near the bottom of the scroll container
  const isNearBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const threshold = 100; // pixels from bottom
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, []);

  // Handle user scroll - detect if they scrolled up manually
  const handleScroll = useCallback(() => {
    if (isNearBottom()) {
      setUserHasScrolled(false);
    } else {
      setUserHasScrolled(true);
    }
  }, [isNearBottom]);

  // Auto-scroll to bottom only when:
  // 1. User sends a new message → always scroll
  // 2. New assistant message starts → scroll if user was near bottom
  // 3. Streaming updates → only scroll if user hasn't scrolled up
  useEffect(() => {
    const isNewMessage = tab.messages.length > lastMessageCount.current;
    lastMessageCount.current = tab.messages.length;

    const lastMessage = tab.messages[tab.messages.length - 1];
    const isUserMessage = lastMessage?.role === 'user';

    // Always scroll to bottom when user sends a message
    if (isNewMessage && isUserMessage) {
      scrollToBottom(true);
      setUserHasScrolled(false);
      return;
    }

    // For new assistant messages or streaming, only scroll if user is near bottom
    if (!userHasScrolled || isNearBottom()) {
      scrollToBottom(true);
    }
  }, [tab.messages, userHasScrolled, isNearBottom, scrollToBottom]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleSend = useCallback(() => {
    if (!input.trim() || !tab.status.initialized || tab.isLoading || tab.routineExecution?.status === 'running') return;

    const content = input.trim();
    setInput('');
    onSend(content);
  }, [input, tab.status.initialized, tab.isLoading, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopyMessage = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, []);

  const formatTime = (timestamp: number | Date | undefined) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Custom message renderer preserving Hosea's visual style
  const renderHoseaMessage = useCallback((message: IChatMessage, index: number) => {
    if (message.role === 'user') {
      return (
        <div key={message.id || index} className="message message--user">
          <div className="message__content">
            <div className="message__text">{message.content}</div>
            <div className="message__time">{formatTime(message.timestamp)}</div>
          </div>
          <div className="message__avatar">
            <User size={16} />
          </div>
        </div>
      );
    }

    if (message.role === 'system') {
      return (
        <div key={message.id || index} className="message message--system">
          <div className="message__content">
            <div className="message__text">{message.content}</div>
          </div>
        </div>
      );
    }

    // Assistant message
    return (
      <div key={message.id || index} className="message message--assistant">
        <div className="message__header">
          <div className="message__avatar">
            <Bot size={16} />
          </div>
        </div>
        <div className="message__content">
          {/* Error display */}
          {message.error && (
            <Alert variant="danger" className="message__error mb-2">
              <AlertCircle size={16} className="me-2" />
              <span>{message.error}</span>
            </Alert>
          )}

          {/* Thinking block */}
          {message.thinking && (
            <ThinkingBlock content={message.thinking} isStreaming={message.isStreaming} />
          )}

          {/* Tool calls */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="message__tool-calls">
              {message.toolCalls.map((toolCall) => (
                <ToolCallCard key={toolCall.id} tool={toolCall} />
              ))}
            </div>
          )}

          {/* Text content */}
          {message.content ? (
            <div className="message__text">
              <MarkdownRenderer content={message.content} isStreaming={message.isStreaming} />
            </div>
          ) : (
            !message.error && message.isStreaming && !message.toolCalls?.length && (
              <div className="message__streaming-indicator">
                <Spinner animation="border" size="sm" />
                <span>Thinking...</span>
              </div>
            )
          )}
        </div>
        {message.content && !message.isStreaming && (
          <div className="message__actions">
            <button
              className="message__action-btn"
              onClick={() => handleCopyMessage(message.content)}
              title="Copy message"
            >
              <Copy size={14} />
            </button>
            <button className="message__action-btn" title="Share">
              <Share size={14} />
            </button>
          </div>
        )}
        <div className="message__time">{formatTime(message.timestamp)}</div>
      </div>
    );
  }, [handleCopyMessage]);

  // Plan handlers that send messages
  const handleApprovePlan = useCallback(() => {
    if (!tab.activePlan) return;
    setPlanLoading('approving');
    onSend('Yes, proceed with the plan.');
    // Reset after a delay (the tab state will be updated by the context)
    setTimeout(() => setPlanLoading(null), 500);
  }, [tab.activePlan, onSend]);

  const handleRejectPlan = useCallback((reason?: string) => {
    if (!tab.activePlan) return;
    setPlanLoading('rejecting');
    const message = reason ? `No, please change the plan: ${reason}` : 'No, please change the plan.';
    onSend(message);
    setTimeout(() => setPlanLoading(null), 500);
  }, [tab.activePlan, onSend]);

  const handlePlanFeedback = useCallback((feedback: string) => {
    if (!tab.activePlan) return;
    onSend(`Feedback on the plan: ${feedback}`);
  }, [tab.activePlan, onSend]);

  // Compute active tool calls for ExecutionProgress
  const activeToolCallsArray = Array.from(tab.activeToolCalls.values());

  return (
    <>
      {/* Fixed Plan Display - outside scrollable area */}
      {tab.activePlan && tab.messages.length > 0 && (
        <div className="chat__plan-fixed">
          <PlanDisplay
            plan={tab.activePlan}
            onApprove={tab.activePlan.status === 'pending' ? handleApprovePlan : undefined}
            onReject={tab.activePlan.status === 'pending' ? handleRejectPlan : undefined}
            onFeedback={tab.activePlan.status === 'pending' ? handlePlanFeedback : undefined}
            isApproving={planLoading === 'approving'}
            isRejecting={planLoading === 'rejecting'}
          />
        </div>
      )}

      {/* Execution Progress */}
      {activeToolCallsArray.length > 0 && (
        <ExecutionProgress
          tools={activeToolCallsArray}
          activeCount={activeToolCallsArray.length}
          isComplete={!tab.isLoading}
        />
      )}

      <div
        ref={messagesContainerRef}
        className={`chat__messages ${tab.messages.length === 0 ? 'chat__messages--empty' : ''}`}
        onScroll={handleScroll}
      >
        {tab.messages.length === 0 ? (
          <div className="chat__welcome">
            <div className="chat__welcome-icon">
              <Bot size={40} />
            </div>
            <h2 className="chat__welcome-title">Welcome to HOSEA</h2>
            <p className="chat__welcome-subtitle">
              {tab.status.initialized
                ? `Connected to ${tab.agentName}. Start a conversation!`
                : 'Configure an LLM provider to get started.'}
            </p>
            {!tab.status.initialized && (
              <Button variant="primary" className="mt-4" onClick={() => navigate('llm-connectors')}>
                Add LLM Provider
              </Button>
            )}
          </div>
        ) : (
          <MessageList
            messages={tab.messages}
            streamingThinking={tab.streamingThinking}
            isStreaming={tab.isLoading}
            autoScroll={!userHasScrolled}
            onCopyMessage={handleCopyMessage}
            renderMessage={renderHoseaMessage}
            hideThinking
            className="chat__messages-inner"
          />
        )}
      </div>

      <div className="chat__input">
        <div className="chat__input-wrapper">
          <div className="chat__input-form">
            <textarea
              ref={textareaRef}
              className="chat__input-field"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                tab.routineExecution?.status === 'running'
                  ? 'Agent is executing a routine...'
                  : tab.status.initialized
                    ? 'Type a message... (Shift+Enter for new line)'
                    : 'Connect to an agent first...'
              }
              disabled={!tab.status.initialized || tab.isLoading || tab.routineExecution?.status === 'running'}
              rows={1}
            />
            {tab.isLoading ? (
              <button
                className="chat__send-btn chat__send-btn--danger"
                onClick={onCancel}
              >
                <Square size={18} />
              </button>
            ) : (
              <button
                className="chat__send-btn"
                onClick={handleSend}
                disabled={!input.trim() || !tab.status.initialized || tab.routineExecution?.status === 'running'}
              >
                <Send size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ============ Empty State (no tabs) ============

function EmptyTabsState({ onCreateTab }: { onCreateTab: () => void }): React.ReactElement {
  const { navigate } = useNavigation();

  return (
    <div className="chat__welcome">
      <div className="chat__welcome-icon">
        <Bot size={40} />
      </div>
      <h2 className="chat__welcome-title">Welcome to HOSEA</h2>
      <p className="chat__welcome-subtitle">
        Create a new tab to start chatting with an agent.
      </p>
      <div className="d-flex gap-2 mt-4">
        <Button variant="primary" onClick={onCreateTab}>
          New Chat
        </Button>
        <Button variant="outline-secondary" onClick={() => navigate('agents')}>
          Configure Agents
        </Button>
      </div>
    </div>
  );
}

// ============ Main Chat Page Content ============

function ChatPageContent(): React.ReactElement {
  const {
    tabs,
    activeTabId,
    getActiveTab,
    sendMessage,
    cancelStream,
    createTab,
    tabCount,
    sidebar,
    setSidebarOpen,
    setSidebarTab,
    setSidebarWidth,
    sendDynamicUIAction,
    pinContextKey,
  } = useTabContext();

  // New tab modal
  const [showNewTabModal, setShowNewTabModal] = useState(false);

  const activeTab = getActiveTab();

  // Voice playback - runs in background, plays audio chunks as they arrive
  useVoiceoverPlayback(
    activeTab?.instanceId ?? null,
    activeTab?.voiceoverEnabled ?? false,
  );

  const handleNewTabClick = () => {
    setShowNewTabModal(true);
  };

  const handleSelectAgent = async (agentConfigId: string, agentName: string) => {
    await createTab(agentConfigId, agentName);
  };

  const handleSend = useCallback((content: string) => {
    sendMessage(content);
  }, [sendMessage]);

  const handleCancel = useCallback(() => {
    cancelStream();
  }, [cancelStream]);

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen(!sidebar.isOpen);
  }, [sidebar.isOpen, setSidebarOpen]);

  const handleTabChange = useCallback((tab: SidebarTab) => {
    setSidebarTab(tab);
  }, [setSidebarTab]);

  const handleDynamicUIAction = useCallback((action: string, elementId?: string, value?: unknown) => {
    sendDynamicUIAction(action, elementId, value);
  }, [sendDynamicUIAction]);

  return (
    <div className="chat-container">
      <div
        className="chat"
        style={{ width: sidebar.isOpen ? `calc(100% - ${sidebar.width}px)` : '100%' }}
      >
        {/* Tab Bar with toolbar actions */}
        <TabBar
          onNewTabClick={handleNewTabClick}
          showInternals={sidebar.isOpen}
          onToggleInternals={handleToggleSidebar}
        />

        {/* Chat content */}
        {activeTab ? (
          <ChatContent
            tab={activeTab}
            onSend={handleSend}
            onCancel={handleCancel}
          />
        ) : tabCount === 0 ? (
          <div className="chat__messages chat__messages--empty">
            <EmptyTabsState onCreateTab={handleNewTabClick} />
          </div>
        ) : null}
      </div>

      {/* Sidebar Panel with tabs */}
      <SidebarPanel
        isOpen={sidebar.isOpen}
        onClose={() => setSidebarOpen(false)}
        width={sidebar.width}
        onWidthChange={setSidebarWidth}
        activeTab={sidebar.activeTab}
        onTabChange={handleTabChange}
        instanceId={activeTab?.instanceId || null}
        dynamicUIContent={activeTab?.dynamicUIContent || null}
        hasDynamicUIUpdate={activeTab?.hasDynamicUIUpdate}
        onDynamicUIAction={handleDynamicUIAction}
        contextEntries={activeTab?.contextEntries || []}
        pinnedContextKeys={activeTab?.pinnedContextKeys || []}
        onPinContextKey={(key, pinned) => pinContextKey(key, pinned)}
        routineExecution={activeTab?.routineExecution}
        userHasControl={activeTab?.userHasControl}
      />

      {/* New Tab Modal */}
      <NewTabModal
        show={showNewTabModal}
        onHide={() => setShowNewTabModal(false)}
        onSelectAgent={handleSelectAgent}
      />
    </div>
  );
}

// ============ Main Export ============
// TabProvider is now at the App root level, so ChatPage just uses the context directly

export function ChatPage(): React.ReactElement {
  return <ChatPageContent />;
}
