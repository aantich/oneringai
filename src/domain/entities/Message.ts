/**
 * Message entity based on OpenAI Responses API format
 */

import { Content } from './Content.js';
import type { InputFileContent, InputImageContent, InputTextContent } from './Content.js';
import type { ReasoningEffort } from '../interfaces/ITextProvider.js';

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  DEVELOPER = 'developer', // Responses API uses "developer" instead of "system"
}

export interface Message {
  type: 'message';
  id?: string;
  role: MessageRole;
  content: Content[]; // Always an array in Responses API
}

export interface CompactionItem {
  type: 'compaction';
  id: string;
  encrypted_content: string;
  /** Provider-readable summary when the compaction protocol exposes one. */
  content?: string | null;
  /** Provider signature that must be replayed verbatim. */
  signature?: string | null;
  /** Opaque provider fields that must be replayed verbatim. */
  providerMetadata?: Record<string, unknown>;
}

export interface ReasoningItem {
  type: 'reasoning';
  id: string;
  effort?: ReasoningEffort;
  summary?: string;
  encrypted_content?: string; // For o-series models
}

/** GPT-6 Astra conversation-scoped reasoning-effort update. */
export interface ConfigurationUpdateItem {
  type: 'configuration_update';
  id?: string;
  reasoning: {
    effort: ReasoningEffort;
  };
}

/** Explicit in-band compaction request. Must be the final input item. */
export interface CompactionTriggerItem {
  type: 'compaction_trigger';
}

/** Top-level function result item for Responses continuations. */
export type ToolCallOutputContent = InputTextContent | InputImageContent | InputFileContent;

export interface FunctionCallOutputItem {
  type: 'function_call_output';
  call_id: string;
  output: string | ToolCallOutputContent[];
}

/** Top-level custom-tool result item for Responses continuations. */
export interface CustomToolCallOutputItem {
  type: 'custom_tool_call_output';
  call_id: string;
  output: string | ToolCallOutputContent[];
}

/** Screenshot result returned after executing an OpenAI computer-use call. */
export interface ComputerCallOutputItem {
  type: 'computer_call_output';
  call_id: string;
  output: ({
    type: 'computer_screenshot';
  } & (
    | { image_url: string; file_id?: string }
    | { file_id: string; image_url?: string }
  ));
  acknowledged_safety_checks?: Array<{
    id: string;
    code?: string | null;
    message?: string | null;
  }>;
  status?: 'in_progress' | 'completed' | 'incomplete';
}

export interface ShellCallOutputContent {
  stdout: string;
  stderr: string;
  outcome:
    | { type: 'exit'; exit_code: number }
    | { type: 'timeout' };
}

/** Result returned after executing an OpenAI client shell call. */
export interface ShellCallOutputItem {
  type: 'shell_call_output';
  call_id: string;
  output: ShellCallOutputContent[];
  max_output_length?: number | null;
  status?: 'in_progress' | 'completed' | 'incomplete';
}

/** Result returned after applying an OpenAI apply-patch operation. */
export interface ApplyPatchCallOutputItem {
  type: 'apply_patch_call_output';
  call_id: string;
  status: 'completed' | 'failed';
  output?: string | null;
}

/** Tool definitions returned by a client-executed OpenAI tool-search call. */
export interface ToolSearchOutputItem {
  type: 'tool_search_output';
  call_id: string;
  execution: 'client';
  tools: Array<Record<string, unknown>>;
  status?: 'in_progress' | 'completed' | 'incomplete';
}

export type InputItem =
  | Message
  | CompactionItem
  | ReasoningItem
  | ConfigurationUpdateItem
  | CompactionTriggerItem
  | FunctionCallOutputItem
  | CustomToolCallOutputItem
  | ComputerCallOutputItem
  | ShellCallOutputItem
  | ApplyPatchCallOutputItem
  | ToolSearchOutputItem;
export type OutputItem = Message | CompactionItem | ReasoningItem;
