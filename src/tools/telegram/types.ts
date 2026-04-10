/**
 * Telegram Tools - Shared Types and Helpers
 *
 * Foundation for all Telegram connector tools.
 * Provides authenticated fetch via Bot API token-in-URL pattern.
 *
 * Key differences from other connectors:
 * - Telegram Bot API puts the token in the URL path: /bot<TOKEN>/<method>
 * - All requests use JSON bodies (POST) or query params (GET)
 * - Responses wrap data in { ok: boolean, result: T, description?: string }
 * - chat_id can be a number (user/group ID) or string (@username / @channel)
 */

import type { Connector } from '../../core/Connector.js';
import type { APIKeyConnectorAuth } from '../../domain/entities/Connector.js';

// ============================================================================
// Token Resolution
// ============================================================================

/**
 * Get the Bot API token from the connector's auth config.
 */
export function getBotToken(connector: Connector): string {
  const auth = connector.config.auth;
  if (auth.type !== 'api_key') {
    throw new TelegramConfigError(
      'Telegram connector must use api_key auth type. Got: ' + auth.type
    );
  }
  if (!(auth as APIKeyConnectorAuth).apiKey) {
    throw new TelegramConfigError(
      'Telegram Bot token not found. Ensure the connector was created with a bot token as the API key.'
    );
  }
  return (auth as APIKeyConnectorAuth).apiKey;
}

// ============================================================================
// Telegram API Helpers
// ============================================================================

export interface TelegramFetchOptions {
  /** JSON body params for POST requests */
  body?: Record<string, unknown>;
}

/**
 * Error from Telegram Bot API
 */
export class TelegramAPIError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: number | undefined,
    public readonly telegramDescription: string
  ) {
    const parts = [`Telegram API error ${statusCode}`];
    if (errorCode !== undefined) parts.push(`(code ${errorCode})`);
    parts.push(`: ${telegramDescription}`);
    super(parts.join(''));
    this.name = 'TelegramAPIError';
  }
}

/**
 * Format any error caught in a Telegram tool's catch block into a detailed string.
 */
export function formatTelegramToolError(prefix: string, error: unknown): string {
  if (error instanceof Error) {
    return `${prefix}: ${error.message}`;
  }
  return `${prefix}: ${String(error)}`;
}

/**
 * Error for missing Telegram configuration
 */
export class TelegramConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelegramConfigError';
  }
}

/** Standard Telegram API response wrapper */
interface TelegramResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
  error_code?: number;
}

/**
 * Make an authenticated Telegram Bot API request.
 *
 * Builds the URL as: /bot<TOKEN>/<method>
 * All calls are POST with JSON body (Telegram supports both GET and POST,
 * but POST with JSON is the most flexible and consistent).
 *
 * @param connector - Telegram connector
 * @param method - Bot API method name (e.g., 'sendMessage', 'getUpdates')
 * @param options - Request options with JSON body
 */
export async function telegramFetch<T = unknown>(
  connector: Connector,
  method: string,
  options?: TelegramFetchOptions
): Promise<T> {
  const token = getBotToken(connector);
  const url = `/bot${token}/${method}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Bypass connector's normal auth header — Telegram uses token-in-URL.
  // We call fetch directly on the base URL.
  const baseURL = connector.config.baseURL || 'https://api.telegram.org';
  const fullURL = `${baseURL}${url}`;

  // Timeout: base connector timeout + server-side hold time (for getUpdates long-polling)
  const connectorTimeout = connector.config.timeout ?? 30000;
  const serverHoldTime = (typeof options?.body?.timeout === 'number' ? options.body.timeout : 0) * 1000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), connectorTimeout + serverHoldTime);

  let response: Response;
  try {
    response = await fetch(fullURL, {
      method: 'POST',
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await response.text();

  let data: TelegramResponse<T>;
  try {
    data = JSON.parse(text) as TelegramResponse<T>;
  } catch {
    throw new TelegramAPIError(response.status, undefined, `Invalid JSON response: ${text.slice(0, 500)}`);
  }

  if (!data.ok) {
    throw new TelegramAPIError(
      response.status,
      data.error_code,
      data.description ?? 'Unknown error'
    );
  }

  return data.result;
}

// ============================================================================
// Result Types
// ============================================================================

/** Telegram User object */
export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/** Telegram Chat object */
export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  description?: string;
  invite_link?: string;
}

/** Telegram Message object */
export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  reply_to_message?: TelegramMessage;
}

/** Telegram PhotoSize object */
export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

/** Telegram Update object (from getUpdates) */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
}

// ============================================================================
// Tool Result Types
// ============================================================================

export interface TelegramSendResult {
  success: boolean;
  message?: TelegramMessage;
  error?: string;
}

export interface TelegramGetMeResult {
  success: boolean;
  bot?: TelegramUser;
  error?: string;
}

export interface TelegramGetChatResult {
  success: boolean;
  chat?: TelegramChat;
  error?: string;
}

export interface TelegramGetUpdatesResult {
  success: boolean;
  updates?: TelegramUpdate[];
  count?: number;
  error?: string;
}

export interface TelegramSetWebhookResult {
  success: boolean;
  error?: string;
}
