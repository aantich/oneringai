/**
 * Slack Tools - Shared Types and Helpers
 *
 * Foundation for all Slack connector tools.
 * Provides authenticated fetch, error handling, timestamp conversion, and result types.
 *
 * Key differences from GitHub/Microsoft:
 * - Slack returns HTTP 200 even on errors — must check `ok` field in JSON body
 * - Most methods are POST with application/x-www-form-urlencoded or JSON body
 * - Timestamps are Unix epoch strings (e.g., "1234567890.123456")
 * - Cursor-based pagination with `response_metadata.next_cursor`
 */

import type { Connector } from '../../core/Connector.js';

// ============================================================================
// Slack API Helpers
// ============================================================================

/**
 * Options for slackFetch
 */
export interface SlackFetchOptions {
  method?: string;
  body?: Record<string, unknown>;
  userId?: string;
  accountId?: string;
  /** Use query params instead of JSON body (for some GET-style methods) */
  queryParams?: Record<string, string | number | boolean>;
}

/**
 * Error from Slack API
 *
 * Slack returns HTTP 200 with `{ ok: false, error: "..." }` on failures.
 */
export class SlackAPIError extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly responseMetadata?: unknown
  ) {
    super(`Slack API error: ${errorCode}`);
    this.name = 'SlackAPIError';
  }
}

/**
 * Base shape of all Slack Web API responses.
 */
interface SlackBaseResponse {
  ok: boolean;
  error?: string;
  response_metadata?: {
    next_cursor?: string;
    [key: string]: unknown;
  };
}

/**
 * Make an authenticated Slack Web API request through the connector.
 *
 * Handles Slack's unique response format where HTTP 200 can still indicate failure
 * via the `ok` field. Throws SlackAPIError on `ok: false`.
 */
export async function slackFetch<T extends SlackBaseResponse = SlackBaseResponse>(
  connector: Connector,
  method: string,
  options?: SlackFetchOptions
): Promise<T> {
  // Slack endpoints are just the method name appended to base URL
  let url = method;

  // Some Slack methods work with query params
  if (options?.queryParams && Object.keys(options.queryParams).length > 0) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.queryParams)) {
      params.append(key, String(value));
    }
    url += (url.includes('?') ? '&' : '?') + params.toString();
  }

  const headers: Record<string, string> = {};
  let bodyStr: string | undefined;

  if (options?.body) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    bodyStr = JSON.stringify(options.body);
  }

  const response = await connector.fetch(
    url,
    {
      method: options?.method ?? 'POST',
      headers,
      body: bodyStr,
    },
    options?.userId,
    options?.accountId
  );

  const text = await response.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new SlackAPIError('invalid_json', { rawResponse: text.slice(0, 500) });
  }

  // Slack returns HTTP 200 even on errors — check the ok field
  if (!data.ok) {
    throw new SlackAPIError(
      data.error ?? 'unknown_error',
      data.response_metadata
    );
  }

  return data;
}

// ============================================================================
// Timestamp Helpers
// ============================================================================

/**
 * Convert an ISO 8601 date string to a Slack timestamp (Unix epoch string).
 *
 * Slack uses Unix epoch seconds as strings (e.g., "1234567890.000000").
 * Accepts ISO 8601 strings or Unix epoch numbers/strings.
 */
export function toSlackTimestamp(input: string): string {
  // Already a Slack timestamp (digits with optional dot)
  if (/^\d+(\.\d+)?$/.test(input)) {
    return input;
  }

  const date = new Date(input);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: "${input}". Use ISO 8601 format (e.g., "2025-01-15T09:00:00Z") or a Slack timestamp.`);
  }

  return (date.getTime() / 1000).toFixed(6);
}

/**
 * Convert a Slack timestamp to an ISO 8601 string.
 */
export function fromSlackTimestamp(ts: string): string {
  const seconds = parseFloat(ts);
  return new Date(seconds * 1000).toISOString();
}

// ============================================================================
// Pagination Helper
// ============================================================================

/**
 * Collect paginated results from a Slack API method.
 *
 * Slack uses cursor-based pagination. This helper calls the method repeatedly
 * until there are no more pages or maxPages is reached.
 */
export async function slackPaginate<TResponse extends SlackBaseResponse, TItem>(
  connector: Connector,
  method: string,
  params: Record<string, unknown>,
  extractItems: (response: TResponse) => TItem[],
  options?: {
    maxPages?: number;
    limit?: number;
    userId?: string;
    accountId?: string;
  }
): Promise<{ items: TItem[]; hasMore: boolean }> {
  const maxPages = options?.maxPages ?? 10;
  const allItems: TItem[] = [];
  let cursor: string | undefined;
  let page = 0;

  while (page < maxPages) {
    const body: Record<string, unknown> = { ...params };
    if (cursor) {
      body.cursor = cursor;
    }

    const response = await slackFetch<TResponse>(connector, method, {
      body,
      userId: options?.userId,
      accountId: options?.accountId,
    });

    const items = extractItems(response);
    allItems.push(...items);

    // Check if we've hit the total limit
    if (options?.limit && allItems.length >= options.limit) {
      return { items: allItems.slice(0, options.limit), hasMore: true };
    }

    // Check for next page
    cursor = response.response_metadata?.next_cursor as string | undefined;
    if (!cursor || cursor.length === 0) {
      break;
    }

    page++;
  }

  return { items: allItems, hasMore: !!cursor };
}

// ============================================================================
// Result Types
// ============================================================================

export interface SlackChannel {
  id: string;
  name: string;
  topic?: string;
  purpose?: string;
  memberCount?: number;
  isArchived: boolean;
  isPrivate: boolean;
  isIM: boolean;
}

export interface SlackListChannelsResult {
  success: boolean;
  channels?: SlackChannel[];
  count?: number;
  hasMore?: boolean;
  error?: string;
}

export interface SlackMessage {
  ts: string;
  date: string;
  user?: string;
  text: string;
  threadTs?: string;
  replyCount?: number;
  reactions?: { name: string; count: number }[];
}

export interface SlackGetMessagesResult {
  success: boolean;
  messages?: SlackMessage[];
  count?: number;
  hasMore?: boolean;
  channel?: string;
  error?: string;
}

export interface SlackPostMessageResult {
  success: boolean;
  ts?: string;
  channel?: string;
  error?: string;
}

export interface SlackGetThreadResult {
  success: boolean;
  messages?: SlackMessage[];
  count?: number;
  parentMessage?: SlackMessage;
  error?: string;
}

export interface SlackGetMentionsResult {
  success: boolean;
  messages?: SlackMentionMessage[];
  count?: number;
  hasMore?: boolean;
  error?: string;
}

export interface SlackMentionMessage {
  ts: string;
  date: string;
  text: string;
  user?: string;
  channel?: { id: string; name?: string };
  threadTs?: string;
  permalink?: string;
}

export interface SlackSearchMessagesResult {
  success: boolean;
  messages?: SlackMentionMessage[];
  count?: number;
  total?: number;
  hasMore?: boolean;
  error?: string;
}

export interface SlackAddReactionResult {
  success: boolean;
  error?: string;
}

export interface SlackUser {
  id: string;
  name: string;
  realName?: string;
  displayName?: string;
  email?: string;
  isBot: boolean;
  isAdmin?: boolean;
  timezone?: string;
}

export interface SlackGetUsersResult {
  success: boolean;
  users?: SlackUser[];
  count?: number;
  hasMore?: boolean;
  error?: string;
}

export interface SlackGetChannelInfoResult {
  success: boolean;
  channel?: SlackChannel & {
    created?: string;
    creator?: string;
    memberCount?: number;
  };
  error?: string;
}

export interface SlackSetChannelTopicResult {
  success: boolean;
  topic?: string;
  error?: string;
}

// ============================================================================
// Internal Slack API Response Types
// ============================================================================

/** @internal */
export interface SlackConversationsListResponse {
  ok: boolean;
  error?: string;
  channels: {
    id: string;
    name: string;
    topic?: { value: string };
    purpose?: { value: string };
    num_members?: number;
    is_archived?: boolean;
    is_private?: boolean;
    is_im?: boolean;
    is_mpim?: boolean;
  }[];
  response_metadata?: { next_cursor?: string };
}

/** @internal */
export interface SlackConversationsHistoryResponse {
  ok: boolean;
  error?: string;
  messages: SlackRawMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
}

/** @internal */
export interface SlackRawMessage {
  ts: string;
  user?: string;
  text: string;
  thread_ts?: string;
  reply_count?: number;
  reactions?: { name: string; count: number; users: string[] }[];
  subtype?: string;
  bot_id?: string;
}

/** @internal */
export interface SlackConversationsRepliesResponse {
  ok: boolean;
  error?: string;
  messages: SlackRawMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
}

/** @internal */
export interface SlackPostMessageResponse {
  ok: boolean;
  error?: string;
  ts: string;
  channel: string;
  message?: SlackRawMessage;
  response_metadata?: { next_cursor?: string };
}

/** @internal */
export interface SlackSearchMessagesResponse {
  ok: boolean;
  error?: string;
  messages: {
    total: number;
    matches: {
      ts: string;
      text: string;
      user?: string;
      channel?: { id: string; name?: string };
      thread_ts?: string;
      permalink?: string;
    }[];
    paging?: { count: number; total: number; page: number; pages: number };
  };
  response_metadata?: { next_cursor?: string };
}

/** @internal */
export interface SlackReactionsAddResponse {
  ok: boolean;
  error?: string;
  response_metadata?: { next_cursor?: string };
}

/** @internal */
export interface SlackUsersListResponse {
  ok: boolean;
  error?: string;
  members: {
    id: string;
    name: string;
    real_name?: string;
    profile?: {
      display_name?: string;
      email?: string;
    };
    is_bot?: boolean;
    is_admin?: boolean;
    tz?: string;
    deleted?: boolean;
  }[];
  response_metadata?: { next_cursor?: string };
}

/** @internal */
export interface SlackUsersInfoResponse {
  ok: boolean;
  error?: string;
  user: {
    id: string;
    name: string;
    real_name?: string;
    profile?: {
      display_name?: string;
      email?: string;
    };
    is_bot?: boolean;
    is_admin?: boolean;
    tz?: string;
  };
  response_metadata?: { next_cursor?: string };
}

/** @internal */
export interface SlackConversationsInfoResponse {
  ok: boolean;
  error?: string;
  channel: {
    id: string;
    name: string;
    topic?: { value: string };
    purpose?: { value: string };
    num_members?: number;
    is_archived?: boolean;
    is_private?: boolean;
    is_im?: boolean;
    is_mpim?: boolean;
    created?: number;
    creator?: string;
  };
  response_metadata?: { next_cursor?: string };
}

/** @internal */
export interface SlackConversationsSetTopicResponse {
  ok: boolean;
  error?: string;
  channel: {
    id: string;
    topic?: { value: string };
  };
  response_metadata?: { next_cursor?: string };
}

/** @internal */
export interface SlackAuthTestResponse {
  ok: boolean;
  error?: string;
  user_id: string;
  user: string;
  team_id: string;
  team: string;
  response_metadata?: { next_cursor?: string };
}

// ============================================================================
// Shared Helpers
// ============================================================================

/**
 * Convert a raw Slack message to our clean format.
 */
export function formatMessage(raw: SlackRawMessage): SlackMessage {
  return {
    ts: raw.ts,
    date: fromSlackTimestamp(raw.ts),
    user: raw.user,
    text: raw.text,
    threadTs: raw.thread_ts,
    replyCount: raw.reply_count,
    reactions: raw.reactions?.map((r) => ({ name: r.name, count: r.count })),
  };
}

/**
 * Get the authenticated bot/user's Slack user ID.
 * Uses `auth.test` — works for both bot and user tokens.
 */
export async function getAuthenticatedUserId(
  connector: Connector,
  userId?: string,
  accountId?: string
): Promise<string> {
  const response = await slackFetch<SlackAuthTestResponse>(connector, '/auth.test', {
    body: {},
    userId,
    accountId,
  });
  return response.user_id;
}
