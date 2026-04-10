/**
 * Google API Tools - Shared Types and Helpers
 *
 * Foundation for all Google API connector tools.
 * Provides authenticated fetch, delegated/service-account mode switching, and result types.
 */

import type { Connector } from '../../core/Connector.js';

// ============================================================================
// Delegated / Service Account Mode
// ============================================================================

/**
 * Check whether a connector uses service-account (non-delegated) authentication.
 * Service-account connectors impersonate via the `sub` claim (domain-wide delegation),
 * so Google API calls may need `userId` param instead of implicit `me`.
 */
export function isServiceAccountAuth(connector: Connector): boolean {
  const auth = connector.config.auth;
  if (auth.type === 'oauth' && auth.flow === 'jwt_bearer') return true;
  if (auth.type === 'oauth' && auth.flow === 'client_credentials') return true;
  if (auth.type === 'jwt') return true;
  return false;
}

/**
 * Get the user identifier for Google API requests.
 *
 * - Service-account flows (jwt_bearer, client_credentials, jwt): returns targetUser (required)
 * - Delegated flow (authorization_code) / API key: returns 'me'
 */
export function getGoogleUserId(connector: Connector, targetUser?: string): string {
  if (isServiceAccountAuth(connector)) {
    if (!targetUser) {
      throw new Error(
        'targetUser is required when using service-account auth (jwt_bearer / client_credentials). ' +
        'Provide a user email (e.g., "user@domain.com").'
      );
    }
    return targetUser;
  }
  return 'me';
}

// ============================================================================
// Google API Helpers
// ============================================================================

/**
 * Options for googleFetch
 */
export interface GoogleFetchOptions {
  method?: string;
  body?: unknown;
  userId?: string;
  accountId?: string;
  queryParams?: Record<string, string | number | boolean>;
  accept?: string;
  /** Additional HTTP headers merged into the request */
  headers?: Record<string, string>;
  /** Base URL override (e.g., 'https://www.googleapis.com' vs 'https://gmail.googleapis.com') */
  baseUrl?: string;
}

/**
 * Error from Google API
 */
export class GoogleAPIError extends Error {
  /** Google error status string (e.g. "PERMISSION_DENIED", "NOT_FOUND") */
  public readonly errorStatus: string | undefined;

  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: unknown
  ) {
    let msg = statusText;
    let errorStatus: string | undefined;

    if (typeof body === 'object' && body !== null && 'error' in body) {
      const err = (body as { error: unknown }).error;
      if (typeof err === 'object' && err !== null) {
        const errObj = err as { message?: string; status?: string; code?: number };
        msg = errObj.message ?? statusText;
        errorStatus = errObj.status;
      } else if (typeof err === 'string') {
        msg = err;
      }
    }

    const parts = [`Google API error ${status}`];
    if (errorStatus) parts.push(`(${errorStatus})`);
    parts.push(`: ${msg}`);

    super(parts.join(''));
    this.name = 'GoogleAPIError';
    this.errorStatus = errorStatus;
  }
}

/**
 * Format any error caught in a Google tool's catch block into a detailed string.
 */
export function formatGoogleToolError(prefix: string, error: unknown): string {
  if (error instanceof Error) {
    return `${prefix}: ${error.message}`;
  }
  return `${prefix}: ${String(error)}`;
}

/**
 * Make an authenticated Google API request through the connector.
 *
 * Adds standard headers and parses JSON response.
 * Handles empty response bodies (e.g., delete returns 204).
 * Throws GoogleAPIError on non-ok responses.
 *
 * Note: The connector's baseURL is https://www.googleapis.com, but some
 * Google APIs use different base URLs (e.g., gmail.googleapis.com).
 * Use the `baseUrl` option to override when needed, or pass full URLs in endpoint.
 */
export async function googleFetch<T = unknown>(
  connector: Connector,
  endpoint: string,
  options?: GoogleFetchOptions
): Promise<T> {
  let url = endpoint;

  // If a baseUrl override is provided and endpoint is relative, prepend it
  // The connector will strip its own baseURL prefix, so we use absolute URLs
  if (options?.baseUrl && !endpoint.startsWith('http')) {
    url = `${options.baseUrl}${endpoint}`;
  }

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
    throw new GoogleAPIError(response.status, response.statusText, data);
  }

  // Handle empty response body (e.g., 204 No Content)
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
 * Same logic as Microsoft tools for consistency.
 */
export function normalizeEmails(input: unknown[]): string[] {
  return input.map((item) => {
    if (typeof item === 'string') return item;
    if (typeof item === 'object' && item !== null) {
      const obj = item as Record<string, unknown>;
      // { emailAddress: { address: "..." } } — Graph-style (cross-compat)
      if (obj.emailAddress && typeof obj.emailAddress === 'object') {
        const ea = obj.emailAddress as Record<string, unknown>;
        if (typeof ea.address === 'string') return ea.address;
      }
      // { address: "..." }
      if (typeof obj.address === 'string') return obj.address;
      // { email: "..." }
      if (typeof obj.email === 'string') return obj.email;
    }
    return String(item);
  });
}

/**
 * Build a RFC 2822 MIME message for Gmail API.
 *
 * Gmail's send/draft endpoints expect a base64url-encoded RFC 2822 message.
 * This builds a multipart/alternative message with HTML body.
 */
export function buildMimeMessage(options: {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  from?: string;
  inReplyTo?: string;
  references?: string;
  threadId?: string;
}): string {
  const lines: string[] = [];

  lines.push(`To: ${options.to.join(', ')}`);
  if (options.cc && options.cc.length > 0) {
    lines.push(`Cc: ${options.cc.join(', ')}`);
  }
  if (options.from) {
    lines.push(`From: ${options.from}`);
  }
  lines.push(`Subject: ${options.subject}`);
  if (options.inReplyTo) {
    lines.push(`In-Reply-To: ${options.inReplyTo}`);
    lines.push(`References: ${options.references ?? options.inReplyTo}`);
  }
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/html; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  // Base64-encode the HTML body, wrapped to 76-char lines per RFC 2822 Section 6.8
  const b64Body = Buffer.from(options.body, 'utf-8').toString('base64');
  lines.push(b64Body.replace(/.{1,76}/g, '$&\r\n').trimEnd());

  return lines.join('\r\n');
}

/**
 * Encode a MIME message string to base64url (RFC 4648 Section 5) for Gmail API.
 */
export function encodeBase64Url(input: string): string {
  return Buffer.from(input, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Strip HTML tags and decode entities to plain text.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

// ============================================================================
// Google-native MIME types for export
// ============================================================================

/** Map of Google-native MIME types to their export format */
export const GOOGLE_NATIVE_MIME_TYPES: Record<string, { exportMimeType: string; extension: string }> = {
  'application/vnd.google-apps.document': { exportMimeType: 'text/plain', extension: '.txt' },
  'application/vnd.google-apps.spreadsheet': { exportMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: '.xlsx' },
  'application/vnd.google-apps.presentation': { exportMimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', extension: '.pptx' },
  'application/vnd.google-apps.drawing': { exportMimeType: 'image/png', extension: '.png' },
};

/**
 * Check if a MIME type is a Google-native format (Docs, Sheets, Slides, Drawings).
 */
export function isGoogleNativeFormat(mimeType: string): boolean {
  return mimeType.startsWith('application/vnd.google-apps.');
}

/** Supported document extensions that DocumentReader can convert to markdown */
export const SUPPORTED_EXTENSIONS = new Set([
  '.docx', '.pptx', '.xlsx', '.csv', '.pdf',
  '.odt', '.odp', '.ods', '.rtf',
  '.html', '.htm',
  '.txt', '.md', '.json', '.xml', '.yaml', '.yml',
]);

/** Default file size limit (50 MB) */
export const DEFAULT_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/** Per-extension file size limits */
export const DEFAULT_FILE_SIZE_LIMITS: Record<string, number> = {
  '.pptx': 100 * 1024 * 1024,
  '.ppt': 100 * 1024 * 1024,
  '.odp': 100 * 1024 * 1024,
};

/**
 * Get the file size limit for a given extension.
 */
export function getFileSizeLimit(
  ext: string,
  overrides?: Record<string, number>,
  defaultLimit?: number,
): number {
  const merged = { ...DEFAULT_FILE_SIZE_LIMITS, ...overrides };
  return merged[ext.toLowerCase()] ?? defaultLimit ?? DEFAULT_MAX_FILE_SIZE_BYTES;
}

// ============================================================================
// Result Types
// ============================================================================

export interface GoogleDraftEmailResult {
  success: boolean;
  draftId?: string;
  messageId?: string;
  threadId?: string;
  error?: string;
}

export interface GoogleSendEmailResult {
  success: boolean;
  messageId?: string;
  threadId?: string;
  error?: string;
}

export interface GoogleCreateMeetingResult {
  success: boolean;
  eventId?: string;
  htmlLink?: string;
  meetLink?: string;
  error?: string;
}

export interface GoogleEditMeetingResult {
  success: boolean;
  eventId?: string;
  htmlLink?: string;
  error?: string;
}

export interface GoogleGetTranscriptResult {
  success: boolean;
  transcript?: string;
  meetingTitle?: string;
  error?: string;
}

/** Summary of a calendar event returned by list_meetings */
export interface GoogleMeetingListEntry {
  eventId: string;
  summary: string;
  start: string;
  end: string;
  timeZone: string;
  organizer?: string;
  attendees?: string[];
  location?: string;
  meetLink?: string;
  isOnlineMeeting: boolean;
  description?: string;
}

export interface GoogleListMeetingsResult {
  success: boolean;
  meetings?: GoogleMeetingListEntry[];
  totalCount?: number;
  error?: string;
}

export interface GoogleGetMeetingResult {
  success: boolean;
  eventId?: string;
  summary?: string;
  start?: string;
  end?: string;
  timeZone?: string;
  organizer?: string;
  attendees?: string[];
  location?: string;
  meetLink?: string;
  htmlLink?: string;
  description?: string;
  isOnlineMeeting: boolean;
  error?: string;
}

// Use the same slot type as Microsoft for API compatibility
export interface MeetingSlotSuggestion {
  start: string;
  end: string;
  confidence: string;
  attendeeAvailability: { attendee: string; availability: string }[];
}

export interface GoogleFindSlotsResult {
  success: boolean;
  slots?: MeetingSlotSuggestion[];
  emptySuggestionsReason?: string;
  error?: string;
}

export interface GoogleReadFileResult {
  success: boolean;
  filename?: string;
  sizeBytes?: number;
  mimeType?: string;
  markdown?: string;
  webUrl?: string;
  error?: string;
}

export interface GoogleListFilesResult {
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
  }[];
  totalCount?: number;
  hasMore?: boolean;
  error?: string;
}

export interface GoogleSearchFilesResult {
  success: boolean;
  results?: {
    name: string;
    path?: string;
    snippet?: string;
    size: number;
    sizeFormatted: string;
    webUrl?: string;
    id: string;
    lastModified?: string;
    mimeType?: string;
  }[];
  totalCount?: number;
  hasMore?: boolean;
  error?: string;
}

// ============================================================================
// Internal Google API Response Types
// ============================================================================

/** @internal Gmail message response */
export interface GmailMessageResponse {
  id: string;
  threadId?: string;
  labelIds?: string[];
  payload?: {
    headers?: { name: string; value: string }[];
    mimeType?: string;
    body?: { data?: string; size?: number };
    parts?: GmailMessagePart[];
  };
  snippet?: string;
}

/** @internal Gmail message part */
export interface GmailMessagePart {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
}

/** @internal Gmail draft response */
export interface GmailDraftResponse {
  id: string;
  message: { id: string; threadId?: string };
}

/** @internal Google Calendar event response */
export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: { email: string; displayName?: string; responseStatus?: string; self?: boolean; resource?: boolean }[];
  location?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: { entryPointType: string; uri: string; label?: string }[];
    conferenceSolution?: { name?: string; key?: { type: string } };
  };
  htmlLink?: string;
  status?: string;
}

/** @internal Google Calendar event list response */
export interface GoogleCalendarEventListResponse {
  items: GoogleCalendarEvent[];
  nextPageToken?: string;
  summary?: string;
  timeZone?: string;
}

/** @internal Google Calendar freeBusy response */
export interface GoogleFreeBusyResponse {
  kind: string;
  timeMin: string;
  timeMax: string;
  calendars: Record<string, {
    busy: { start: string; end: string }[];
    errors?: { domain: string; reason: string }[];
  }>;
}

/** @internal Google Drive file metadata */
export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string; // Drive API returns size as string
  webViewLink?: string;
  webContentLink?: string;
  modifiedTime?: string;
  createdTime?: string;
  parents?: string[];
  trashed?: boolean;
  description?: string;
}

/** @internal Google Drive file list response */
export interface GoogleDriveFileListResponse {
  files: GoogleDriveFile[];
  nextPageToken?: string;
  incompleteSearch?: boolean;
}
