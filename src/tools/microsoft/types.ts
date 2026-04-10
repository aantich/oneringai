/**
 * Microsoft Graph Tools - Shared Types and Helpers
 *
 * Foundation for all Microsoft Graph connector tools.
 * Provides authenticated fetch, delegated/app mode switching, and result types.
 */

import type { Connector } from '../../core/Connector.js';

// ============================================================================
// Delegated / Application Mode
// ============================================================================

/**
 * Check whether a connector uses app-level (non-delegated) authentication.
 * App-level connectors access resources on behalf of the application, not a
 * specific signed-in user, so Microsoft Graph calls must use `/users/{id}`
 * instead of `/me`.
 *
 * Detection logic:
 * - `authorization_code` → delegated (user signed in)
 * - `client_credentials` / `jwt_bearer` → app-only
 * - `jwt` auth type → app-only
 * - Missing flow or `api_key` → assume delegated (safest default)
 */
export function isAppPermissionAuth(connector: Connector): boolean {
  const auth = connector.config.auth;

  // OAuth connectors: check the flow field
  if (auth.type === 'oauth') {
    // Explicit delegated flow — definitely not app-only
    if (auth.flow === 'authorization_code') return false;
    // Explicit app-only flows
    if (auth.flow === 'client_credentials') return true;
    if (auth.flow === 'jwt_bearer') return true;
    // Missing or unknown flow — default to delegated (safest)
    return false;
  }

  // JWT auth type is always app-only
  if (auth.type === 'jwt') return true;

  // api_key, none, or other — assume delegated
  return false;
}

/**
 * Get the user path prefix for Microsoft Graph API requests.
 *
 * - App-permission flows (client_credentials, jwt_bearer, jwt): returns `/users/${targetUser}`
 * - Delegated flow (authorization_code): returns `/me` (ignores targetUser)
 * - API key / other: returns `/me`
 */
export function getUserPathPrefix(connector: Connector, targetUser?: string): string {
  if (isAppPermissionAuth(connector)) {
    if (!targetUser) {
      const auth = connector.config.auth;
      const flowInfo = auth.type === 'oauth' ? ` (flow: ${auth.flow})` : ` (type: ${auth.type})`;
      throw new Error(
        `targetUser is required when using app-permission auth${flowInfo}. ` +
        'Provide a user ID or UPN (e.g., "user@domain.com"). ' +
        'If this connector uses delegated (user) auth, check that the auth config has flow: "authorization_code".'
      );
    }
    return `/users/${targetUser}`;
  }
  return '/me';
}

// ============================================================================
// Microsoft Graph API Helpers
// ============================================================================

/**
 * Options for microsoftFetch
 */
export interface MicrosoftFetchOptions {
  method?: string;
  body?: unknown;
  userId?: string;
  accountId?: string;
  queryParams?: Record<string, string | number | boolean>;
  accept?: string;
  /** Additional HTTP headers merged into the request (e.g. Prefer) */
  headers?: Record<string, string>;
}

/**
 * Error from Microsoft Graph API
 */
export class MicrosoftAPIError extends Error {
  /** Graph error code (e.g. "ErrorAccessDenied", "Authorization_RequestDenied") */
  public readonly code: string | undefined;
  /** Request ID from Graph API for support / debugging */
  public readonly requestId: string | undefined;

  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: unknown
  ) {
    let msg = statusText;
    let code: string | undefined;
    let requestId: string | undefined;

    if (typeof body === 'object' && body !== null && 'error' in body) {
      const err = (body as { error: { code?: string; message?: string; innerError?: { 'request-id'?: string; date?: string } } }).error;
      msg = err?.message ?? statusText;
      code = err?.code;
      requestId = err?.innerError?.['request-id'];
    }

    // Build a detailed message: status + code + message + request-id
    const parts = [`Microsoft Graph API error ${status}`];
    if (code) parts.push(`(${code})`);
    parts.push(`: ${msg}`);
    if (requestId) parts.push(` [request-id: ${requestId}]`);

    super(parts.join(''));
    this.name = 'MicrosoftAPIError';
    this.code = code;
    this.requestId = requestId;
  }
}

/**
 * Format any error caught in a Microsoft tool's catch block into a detailed string.
 *
 * For MicrosoftAPIError: includes status, code, message, and request-id.
 * For other errors: includes message + stringified body if available.
 */
export function formatMicrosoftToolError(prefix: string, error: unknown): string {
  if (error instanceof MicrosoftAPIError) {
    return `${prefix}: ${error.message}`;
  }
  if (error instanceof Error) {
    return `${prefix}: ${error.message}`;
  }
  return `${prefix}: ${String(error)}`;
}

/**
 * Make an authenticated Microsoft Graph API request through the connector.
 *
 * Adds standard headers and parses JSON response.
 * Handles empty response bodies (e.g., sendMail returns 202 with no body).
 * Throws MicrosoftAPIError on non-ok responses.
 */
export async function microsoftFetch<T = unknown>(
  connector: Connector,
  endpoint: string,
  options?: MicrosoftFetchOptions
): Promise<T> {
  let url = endpoint;

  // Add query params if provided
  if (options?.queryParams && Object.keys(options.queryParams).length > 0) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.queryParams)) {
      params.append(key, String(value));
    }
    url += (url.includes('?') ? '&' : '?') + params.toString();
  }

  const headers: Record<string, string> = {
    'Accept': options?.accept ?? 'application/json',
    ...options?.headers,
  };

  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await connector.fetch(
    url,
    {
      method: options?.method ?? 'GET',
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    },
    options?.userId,
    options?.accountId
  );

  const text = await response.text();

  if (!response.ok) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    throw new MicrosoftAPIError(response.status, response.statusText, data);
  }

  // Handle empty response body (e.g., sendMail returns 202)
  if (!text || text.trim().length === 0) {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

// ============================================================================
// Utility Helpers
// ============================================================================

/**
 * Normalize an email array from any format the LLM might send into plain strings.
 *
 * Accepts:
 * - Plain strings: `["alice@contoso.com"]`
 * - Graph recipient objects: `[{ emailAddress: { address: "alice@contoso.com" } }]`
 * - Graph attendee objects: `[{ emailAddress: { address: "alice@contoso.com", name: "Alice" }, type: "required" }]`
 * - Bare email objects: `[{ address: "alice@contoso.com" }]` or `[{ email: "alice@contoso.com" }]`
 *
 * Always returns `string[]` of email addresses.
 */
export function normalizeEmails(input: unknown[]): string[] {
  return input.map((item) => {
    if (typeof item === 'string') return item;
    if (typeof item === 'object' && item !== null) {
      const obj = item as Record<string, unknown>;
      // { emailAddress: { address: "..." } } — Graph recipient/attendee format
      if (obj.emailAddress && typeof obj.emailAddress === 'object') {
        const ea = obj.emailAddress as Record<string, unknown>;
        if (typeof ea.address === 'string') return ea.address;
      }
      // { address: "..." } — bare email object
      if (typeof obj.address === 'string') return obj.address;
      // { email: "..." } — common LLM mistake
      if (typeof obj.email === 'string') return obj.email;
    }
    // Last resort: stringify and hope for the best
    return String(item);
  });
}

/**
 * Convert an array of email addresses (any format) to Microsoft Graph recipient format.
 * Normalizes input first, so it's safe to pass LLM output directly.
 */
export function formatRecipients(emails: unknown[]): { emailAddress: { address: string } }[] {
  return normalizeEmails(emails).map((address) => ({ emailAddress: { address } }));
}

/**
 * Convert an array of email addresses (any format) to Microsoft Graph attendee format.
 * Normalizes input first, so it's safe to pass LLM output directly.
 */
export function formatAttendees(emails: unknown[]): { emailAddress: { address: string }; type: string }[] {
  return normalizeEmails(emails).map((address) => ({
    emailAddress: { address },
    type: 'required',
  }));
}

/**
 * Check if a meeting ID input is a Teams join URL.
 *
 * Teams join URLs look like:
 * - `https://teams.microsoft.com/l/meetup-join/19%3ameeting_...`
 * - `https://teams.live.com/l/meetup-join/...`
 *
 * IMPORTANT: A Teams join URL does NOT contain the Graph API meeting ID.
 * To resolve a URL to a meeting ID, use `resolveMeetingId()` which calls
 * `GET /me/onlineMeetings?$filter=JoinWebUrl eq '{url}'`.
 */
export function isTeamsMeetingUrl(input: string): boolean {
  try {
    const url = new URL(input.trim());
    return (
      (url.hostname === 'teams.microsoft.com' || url.hostname === 'teams.live.com') &&
      url.pathname.includes('meetup-join')
    );
  } catch {
    return false;
  }
}

/** @internal Graph API response for onlineMeetings filter query */
export interface GraphOnlineMeetingListResponse {
  value: { id: string; subject?: string; joinWebUrl?: string }[];
}

/**
 * Resolve a meeting input (ID or Teams URL) to a Graph API online meeting ID.
 *
 * - Raw meeting IDs are passed through as-is
 * - Teams join URLs are resolved via `GET /me/onlineMeetings?$filter=JoinWebUrl eq '{url}'`
 *
 * @returns The resolved meeting ID and optional subject
 * @throws Error if the URL cannot be resolved or input is empty
 */
export async function resolveMeetingId(
  connector: Connector,
  input: string,
  prefix: string,
  effectiveUserId?: string,
  effectiveAccountId?: string
): Promise<{ meetingId: string; subject?: string }> {
  if (!input || input.trim().length === 0) {
    throw new Error('Meeting ID cannot be empty');
  }

  const trimmed = input.trim();

  if (!isTeamsMeetingUrl(trimmed)) {
    return { meetingId: trimmed };
  }

  // Resolve Teams URL to meeting ID via Graph API filter
  const meetings = await microsoftFetch<GraphOnlineMeetingListResponse>(
    connector,
    `${prefix}/onlineMeetings`,
    {
      userId: effectiveUserId,
      accountId: effectiveAccountId,
      queryParams: { '$filter': `JoinWebUrl eq '${trimmed}'` },
    }
  );

  if (!meetings.value || meetings.value.length === 0) {
    throw new Error(
      `Could not find an online meeting matching the provided Teams URL. ` +
      `Make sure the URL is correct and you have access to this meeting.`
    );
  }

  return {
    meetingId: meetings.value[0]!.id,
    subject: meetings.value[0]!.subject,
  };
}

// ============================================================================
// Result Types
// ============================================================================

export interface MicrosoftDraftEmailResult {
  success: boolean;
  draftId?: string;
  webLink?: string;
  error?: string;
}

export interface MicrosoftSendEmailResult {
  success: boolean;
  error?: string;
}

export interface MicrosoftCreateMeetingResult {
  success: boolean;
  eventId?: string;
  webLink?: string;
  onlineMeetingUrl?: string;
  error?: string;
}

export interface MicrosoftEditMeetingResult {
  success: boolean;
  eventId?: string;
  webLink?: string;
  error?: string;
}

export interface MicrosoftGetTranscriptResult {
  success: boolean;
  transcript?: string;
  meetingSubject?: string;
  error?: string;
}

/** Summary of a calendar event returned by list_meetings */
export interface MeetingListEntry {
  eventId: string;
  subject: string;
  start: string;
  end: string;
  timeZone: string;
  organizer?: string;
  attendees?: string[];
  location?: string;
  /** Online meeting join URL — may be Teams, Zoom, or any other provider */
  joinUrl?: string;
  isOnlineMeeting: boolean;
  bodyPreview?: string;
}

export interface MicrosoftListMeetingsResult {
  success: boolean;
  meetings?: MeetingListEntry[];
  totalCount?: number;
  error?: string;
}

export interface MicrosoftGetMeetingResult {
  success: boolean;
  eventId?: string;
  subject?: string;
  start?: string;
  end?: string;
  timeZone?: string;
  organizer?: string;
  attendees?: string[];
  location?: string;
  /** Online meeting join URL — may be Teams, Zoom, or any other provider */
  joinUrl?: string;
  webLink?: string;
  body?: string;
  isOnlineMeeting: boolean;
  error?: string;
}

export interface MicrosoftFindSlotsResult {
  success: boolean;
  slots?: MeetingSlotSuggestion[];
  emptySuggestionsReason?: string;
  error?: string;
}

export interface MeetingSlotSuggestion {
  start: string;
  end: string;
  confidence: string;
  attendeeAvailability: { attendee: string; availability: string }[];
}

// ============================================================================
// Internal Graph API Response Types
// ============================================================================

/** @internal */
export interface GraphMessageResponse {
  id: string;
  webLink?: string;
  subject?: string;
  [key: string]: unknown;
}

/** @internal */
export interface GraphEventResponse {
  id: string;
  webLink?: string;
  subject?: string;
  onlineMeeting?: { joinUrl?: string } | null;
  [key: string]: unknown;
}

/** @internal */
export interface GraphCalendarViewEvent {
  id: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  start?: { dateTime: string; timeZone: string };
  end?: { dateTime: string; timeZone: string };
  organizer?: { emailAddress: { name?: string; address: string } };
  attendees?: { emailAddress: { name?: string; address: string }; type?: string }[];
  location?: { displayName?: string };
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string } | null;
  onlineMeetingUrl?: string;
  webLink?: string;
}

/** @internal */
export interface GraphCalendarViewResponse {
  value: GraphCalendarViewEvent[];
  '@odata.nextLink'?: string;
  '@odata.count'?: number;
}

/** @internal */
export interface GraphTranscriptListResponse {
  value: { id: string; createdDateTime?: string }[];
}

/** @internal */
export interface GraphFindMeetingTimesResponse {
  meetingTimeSuggestions: {
    confidence: number;
    meetingTimeSlot: {
      start: { dateTime: string; timeZone: string };
      end: { dateTime: string; timeZone: string };
    };
    attendeeAvailability: {
      attendee: { emailAddress: { address: string } };
      availability: string;
    }[];
  }[];
  emptySuggestionsReason?: string;
}

// ============================================================================
// File / Drive Types and Helpers
// ============================================================================

/** @internal Graph driveItem metadata */
export interface GraphDriveItem {
  id: string;
  name: string;
  size: number;
  webUrl?: string;
  lastModifiedDateTime?: string;
  createdDateTime?: string;
  file?: { mimeType?: string; hashes?: Record<string, string> };
  folder?: { childCount?: number };
  parentReference?: {
    driveId?: string;
    driveType?: string;
    id?: string;
    name?: string;
    path?: string;
    siteId?: string;
  };
  '@microsoft.graph.downloadUrl'?: string;
}

/** @internal Graph response for listing children or search results */
export interface GraphDriveItemListResponse {
  value: GraphDriveItem[];
  '@odata.nextLink'?: string;
  '@odata.count'?: number;
}

/** @internal Graph search API response */
export interface GraphSearchResponse {
  value: {
    hitsContainers: {
      hits: {
        hitId: string;
        summary?: string;
        resource: GraphDriveItem & {
          parentReference?: GraphDriveItem['parentReference'] & { name?: string };
        };
      }[];
      total: number;
      moreResultsAvailable: boolean;
    }[];
  }[];
}

// ---- Result types ----

export interface MicrosoftReadFileResult {
  success: boolean;
  filename?: string;
  sizeBytes?: number;
  mimeType?: string;
  markdown?: string;
  webUrl?: string;
  error?: string;
}

export interface MicrosoftListFilesResult {
  success: boolean;
  items?: {
    name: string;
    type: 'file' | 'folder';
    size: number;
    sizeFormatted: string;
    mimeType?: string;
    lastModified?: string;
    webUrl?: string;
    id: string;
    childCount?: number;
  }[];
  totalCount?: number;
  hasMore?: boolean;
  error?: string;
}

export interface MicrosoftSearchFilesResult {
  success: boolean;
  results?: {
    name: string;
    path?: string;
    site?: string;
    snippet?: string;
    size: number;
    sizeFormatted: string;
    webUrl?: string;
    id: string;
    lastModified?: string;
  }[];
  totalCount?: number;
  hasMore?: boolean;
  error?: string;
}

// ---- File source resolution ----

/** Default file size limit (50 MB) */
export const DEFAULT_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Per-extension file size limits.
 * Presentations can be very large due to embedded images, but since we extract
 * text/markdown only (images are discarded), larger limits are safe.
 */
export const DEFAULT_FILE_SIZE_LIMITS: Record<string, number> = {
  '.pptx': 100 * 1024 * 1024,  // 100 MB — presentations are image-heavy
  '.ppt':  100 * 1024 * 1024,
  '.odp':  100 * 1024 * 1024,
};

/**
 * Get the file size limit for a given extension.
 * Checks per-extension overrides first, then falls back to the default.
 */
export function getFileSizeLimit(
  ext: string,
  overrides?: Record<string, number>,
  defaultLimit?: number,
): number {
  const merged = { ...DEFAULT_FILE_SIZE_LIMITS, ...overrides };
  return merged[ext.toLowerCase()] ?? defaultLimit ?? DEFAULT_MAX_FILE_SIZE_BYTES;
}

/** Supported document extensions that DocumentReader can convert to markdown */
export const SUPPORTED_EXTENSIONS = new Set([
  '.docx', '.pptx', '.xlsx', '.csv', '.pdf',
  '.odt', '.odp', '.ods', '.rtf',
  '.html', '.htm',
  '.txt', '.md', '.json', '.xml', '.yaml', '.yml',
]);

/**
 * Encode a sharing URL into the Graph API sharing token format.
 *
 * Microsoft Graph's `/shares/{token}` endpoint accepts base64url-encoded URLs
 * prefixed with `u!`. This is the documented way to access files via sharing links
 * or direct web URLs without knowing the driveId/itemId.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/shares-get
 */
export function encodeSharingUrl(webUrl: string): string {
  const base64 = Buffer.from(webUrl, 'utf-8')
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\//g, '_')
    .replace(/\+/g, '-');
  return `u!${base64}`;
}

/**
 * Check if a string looks like a web URL (http/https).
 */
export function isWebUrl(source: string): boolean {
  return /^https?:\/\//i.test(source.trim());
}

/**
 * Check if a string looks like a OneDrive/SharePoint web URL.
 *
 * Matches:
 * - `*.sharepoint.com/*`
 * - `onedrive.live.com/*`
 * - `1drv.ms/*`
 * - `*.sharepoint-df.com/*` (dogfood/test)
 */
export function isMicrosoftFileUrl(source: string): boolean {
  try {
    const url = new URL(source.trim());
    const host = url.hostname.toLowerCase();
    return (
      host.endsWith('.sharepoint.com') ||
      host.endsWith('.sharepoint-df.com') ||
      host === 'onedrive.live.com' ||
      host === '1drv.ms'
    );
  } catch {
    return false;
  }
}

/**
 * Determine the drive prefix for Graph API calls.
 *
 * Priority:
 * 1. siteId → `/sites/{siteId}/drive`
 * 2. driveId → `/drives/{driveId}`
 * 3. fallback → `{userPrefix}/drive` (e.g., `/me/drive`)
 */
export function getDrivePrefix(
  userPrefix: string,
  options?: { siteId?: string; driveId?: string }
): string {
  if (options?.siteId) return `/sites/${options.siteId}/drive`;
  if (options?.driveId) return `/drives/${options.driveId}`;
  return `${userPrefix}/drive`;
}

/**
 * Build the Graph API endpoint and metadata endpoint for a file source.
 *
 * Handles three input types:
 * 1. Web URL (SharePoint/OneDrive link) → uses `/shares/{token}/driveItem`
 * 2. Path (starts with `/`) → uses `/drive/root:{path}:`
 * 3. Item ID → uses `/drive/items/{id}`
 *
 * @returns Object with `metadataEndpoint` (for item info) and `contentEndpoint` (for download)
 */
export function resolveFileEndpoints(
  source: string,
  drivePrefix: string
): { metadataEndpoint: string; contentEndpoint: string; isSharedUrl: boolean } {
  const trimmed = source.trim();

  // Web URL → sharing link resolution
  if (isWebUrl(trimmed)) {
    const token = encodeSharingUrl(trimmed);
    return {
      metadataEndpoint: `/shares/${token}/driveItem`,
      contentEndpoint: `/shares/${token}/driveItem/content`,
      isSharedUrl: true,
    };
  }

  // Path → root-relative
  if (trimmed.startsWith('/')) {
    const path = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
    return {
      metadataEndpoint: `${drivePrefix}/root:${path}:`,
      contentEndpoint: `${drivePrefix}/root:${path}:/content`,
      isSharedUrl: false,
    };
  }

  // Item ID
  return {
    metadataEndpoint: `${drivePrefix}/items/${trimmed}`,
    contentEndpoint: `${drivePrefix}/items/${trimmed}/content`,
    isSharedUrl: false,
  };
}

/**
 * Format a file size in bytes to a human-readable string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
