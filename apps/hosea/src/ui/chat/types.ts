/**
 * Shared chat UI types.
 * Both apps can use these directly or extend them with app-specific fields.
 */

/** Base message type — apps can extend with their own fields */
export interface IChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number | Date;
  isStreaming?: boolean;
  /** Thinking/reasoning content from the LLM */
  thinking?: string;
  /** Tool calls associated with this message */
  toolCalls?: IToolCallInfo[];
  /** Error message if the response failed */
  error?: string;
  /** Retry information if the response is being retried */
  retryInfo?: { attempt: number; maxAttempts: number };
  /** Non-fatal warning (e.g., response truncation) */
  warning?: string;
}

/** Shared tool call type (superset of both apps) */
export interface IToolCallInfo {
  id: string;
  name: string;
  description?: string;
  args?: Record<string, unknown>;
  status: 'pending' | 'running' | 'complete' | 'error' | 'approval_pending';
  durationMs?: number;
  result?: unknown;
  error?: string;
}

/** Props for StreamingText */
export interface IStreamingTextProps {
  text: string;
  isStreaming?: boolean;
  renderMarkdown?: boolean;
  className?: string;
  showCursor?: boolean;
}

/** Props for ToolCallCard */
export interface IToolCallCardProps {
  tool: IToolCallInfo;
  expanded?: boolean;
  className?: string;
}

/** Props for ExecutionProgress */
export interface IExecutionProgressProps {
  tools: IToolCallInfo[];
  activeCount: number;
  isComplete: boolean;
}

/** Props for ChatControls */
export interface IChatControlsProps {
  isRunning?: boolean;
  isPaused?: boolean;
  hasError?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'lg';
}

/** Props for ExportMessage */
export interface IExportMessageProps {
  messageElement: HTMLElement | null;
  markdownContent?: string;
  onExport?: (format: 'pdf' | 'docx') => Promise<void>;
  className?: string;
  disabled?: boolean;
}

/** Props for ThinkingBlock */
export interface IThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
  defaultCollapsed?: boolean;
  className?: string;
}

// ============================================================
// Tool Permission / Approval Types
// ============================================================

/** Tool approval request data (serializable across IPC) */
export interface IToolApprovalRequest {
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  approvalMessage?: string;
  sensitiveArgs?: string[];
  suggestedScope: 'once' | 'session' | 'persistent';
  toolCategory?: string;
  toolSource?: string;
  description?: string;
}

/** Approval decision from the user */
export interface IToolApprovalDecision {
  requestId: string;
  approved: boolean;
  scope: 'once' | 'session' | 'always' | 'never';
  remember: boolean;
}

/** Props for ToolApprovalBanner */
export interface IToolApprovalBannerProps {
  request: IToolApprovalRequest;
  onApprove: (decision: IToolApprovalDecision) => void;
  onDeny: (decision: IToolApprovalDecision) => void;
  isResponding?: boolean;
  className?: string;
}

/** Permission rule for UI display */
export interface IPermissionRuleInfo {
  id: string;
  toolName: string;
  action: 'allow' | 'deny' | 'ask';
  conditions?: Array<{ argName: string; operator: string; value: string }>;
  unconditional: boolean;
  enabled: boolean;
  description?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string | null;
}

/** Condition form data for the rule editor */
export interface IConditionFormData {
  argName: string;
  operator: string;
  value: string;
}

/** New rule data (without server-generated fields) */
export type INewPermissionRule = Omit<IPermissionRuleInfo, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;

/** Props for PermissionRulesList (read-only list with toggle/delete) */
export interface IPermissionRulesListProps {
  rules: IPermissionRuleInfo[];
  onToggleRule?: (ruleId: string, enabled: boolean) => void;
  onDeleteRule?: (ruleId: string) => void;
  onClearSession?: () => void;
  className?: string;
}

/** Props for PermissionRulesEditor (full CRUD) */
export interface IPermissionRulesEditorProps {
  rules: IPermissionRuleInfo[];
  /** Tool names for the dropdown (e.g., ['bash', 'write_file', '*']) */
  availableTools: string[];
  onAddRule?: (rule: INewPermissionRule) => void;
  onUpdateRule?: (ruleId: string, updates: Partial<IPermissionRuleInfo>) => void;
  onToggleRule?: (ruleId: string, enabled: boolean) => void;
  onDeleteRule?: (ruleId: string) => void;
  onClearSession?: () => void;
  className?: string;
}

/** Props for MessageList */
export interface IMessageListProps {
  messages: IChatMessage[];
  streamingText?: string;
  streamingThinking?: string;
  isStreaming?: boolean;
  autoScroll?: boolean;
  hideThinking?: boolean;
  className?: string;
  renderMessage?: (message: IChatMessage, index: number) => React.ReactNode;
  onCopyMessage?: (content: string) => void;
  onExport?: (message: IChatMessage, element: HTMLElement) => void;
  /** Callback when user interacts with an interactive UI block in a message */
  onInteractiveAction?: import('../interactive-ui/types').OnInteractiveAction;
}
