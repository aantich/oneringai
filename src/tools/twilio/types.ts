/**
 * Twilio Tools - Shared Types and Helpers
 *
 * Foundation for all Twilio connector tools.
 * Provides authenticated fetch, Account SID resolution, and result types.
 *
 * Key differences from other connectors:
 * - Twilio uses HTTP Basic Auth (AccountSid:AuthToken)
 * - Account SID must be in the URL path: /Accounts/{AccountSid}/...
 * - Account SID is stored in connector auth.extra.accountId
 * - Twilio returns standard HTTP status codes (not 200-with-error like Slack)
 * - WhatsApp uses the same Messages API but with "whatsapp:" prefix on phone numbers
 * - Pagination uses next_page_uri (not cursor-based)
 */

import type { Connector } from '../../core/Connector.js';
import type { APIKeyConnectorAuth } from '../../domain/entities/Connector.js';

// ============================================================================
// Account SID Resolution
// ============================================================================

/**
 * Get the Twilio Account SID from the connector's auth extra fields.
 *
 * The Account SID is stored in `auth.extra.accountId` when the connector
 * is created via the Twilio vendor template.
 *
 * @throws Error if Account SID is not configured
 */
export function getAccountSid(connector: Connector): string {
  const auth = connector.config.auth as APIKeyConnectorAuth;
  const accountSid = auth.extra?.accountId;

  if (!accountSid) {
    throw new TwilioConfigError(
      'Twilio Account SID not found. Ensure the connector was created with accountId in auth config.'
    );
  }

  return accountSid;
}

// ============================================================================
// Twilio API Helpers
// ============================================================================

/**
 * Options for twilioFetch
 */
export interface TwilioFetchOptions {
  method?: string;
  /** Form-encoded body params (Twilio uses application/x-www-form-urlencoded for POST) */
  body?: Record<string, string>;
  /** Query string params (for GET requests) */
  queryParams?: Record<string, string>;
  userId?: string;
  accountId?: string;
}

/**
 * Error from Twilio API
 */
export class TwilioAPIError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly twilioCode: number | undefined,
    public readonly twilioMessage: string
  ) {
    super(`Twilio API error (${statusCode}): ${twilioMessage}`);
    this.name = 'TwilioAPIError';
  }
}

/**
 * Error for missing Twilio configuration
 */
export class TwilioConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TwilioConfigError';
  }
}

/**
 * Make an authenticated Twilio API request through the connector.
 *
 * Automatically resolves the Account SID and builds the correct URL path.
 * Twilio endpoints follow: /Accounts/{AccountSid}/{resource}.json
 *
 * @param connector - Twilio connector
 * @param resource - API resource path (e.g., "/Messages.json", "/Messages/SM123.json")
 * @param options - Request options
 */
export async function twilioFetch<T = unknown>(
  connector: Connector,
  resource: string,
  options?: TwilioFetchOptions
): Promise<T> {
  const accountSid = getAccountSid(connector);

  // Build URL path: /Accounts/{AccountSid}/{resource}
  let url = `/Accounts/${accountSid}${resource.startsWith('/') ? resource : `/${resource}`}`;

  // Append query params for GET requests
  if (options?.queryParams && Object.keys(options.queryParams).length > 0) {
    const params = new URLSearchParams(options.queryParams);
    url += (url.includes('?') ? '&' : '?') + params.toString();
  }

  const headers: Record<string, string> = {};
  let bodyStr: string | undefined;

  // Twilio uses application/x-www-form-urlencoded for POST requests
  if (options?.body && Object.keys(options.body).length > 0) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    bodyStr = new URLSearchParams(options.body).toString();
  }

  const response = await connector.fetch(
    url,
    {
      method: options?.method ?? 'GET',
      headers,
      body: bodyStr,
    },
    options?.userId,
    options?.accountId
  );

  const text = await response.text();

  if (!response.ok) {
    let twilioCode: number | undefined;
    let twilioMessage = text;

    try {
      const errorData = JSON.parse(text) as { code?: number; message?: string };
      twilioCode = errorData.code;
      twilioMessage = errorData.message ?? text;
    } catch {
      // Non-JSON error response
    }

    throw new TwilioAPIError(response.status, twilioCode, twilioMessage);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new TwilioAPIError(200, undefined, `Invalid JSON response: ${text.slice(0, 500)}`);
  }
}

// ============================================================================
// Phone Number Helpers
// ============================================================================

/**
 * Normalize a phone number to E.164 format.
 * Ensures the number starts with '+'.
 */
export function normalizePhoneNumber(phone: string): string {
  const cleaned = phone.trim();
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.startsWith('whatsapp:')) return cleaned;
  return `+${cleaned}`;
}

/**
 * Add the WhatsApp prefix to a phone number.
 * If already prefixed, returns as-is.
 */
export function toWhatsAppNumber(phone: string): string {
  const normalized = normalizePhoneNumber(phone);
  if (normalized.startsWith('whatsapp:')) return normalized;
  return `whatsapp:${normalized}`;
}

// ============================================================================
// Result Types
// ============================================================================

export interface TwilioMessage {
  sid: string;
  from: string;
  to: string;
  body: string;
  status: string;
  direction: string;
  dateSent: string | null;
  dateCreated: string;
  price: string | null;
  priceUnit: string | null;
  numSegments: string | null;
  errorCode: number | null;
  errorMessage: string | null;
  channel: 'sms' | 'whatsapp';
}

export interface TwilioSendResult {
  success: boolean;
  message?: TwilioMessage;
  error?: string;
}

export interface TwilioListMessagesResult {
  success: boolean;
  messages?: TwilioMessage[];
  count?: number;
  hasMore?: boolean;
  error?: string;
}

export interface TwilioGetMessageResult {
  success: boolean;
  message?: TwilioMessage;
  error?: string;
}

// ============================================================================
// Internal Twilio API Response Types
// ============================================================================

/** @internal Raw Twilio message from the API */
export interface TwilioRawMessage {
  sid: string;
  from: string;
  to: string;
  body: string;
  status: string;
  direction: string;
  date_sent: string | null;
  date_created: string;
  price: string | null;
  price_unit: string | null;
  num_segments: string | null;
  error_code: number | null;
  error_message: string | null;
  uri: string;
}

/** @internal Twilio list messages response */
export interface TwilioListResponse {
  messages: TwilioRawMessage[];
  first_page_uri: string;
  next_page_uri: string | null;
  previous_page_uri: string | null;
  page: number;
  page_size: number;
  uri: string;
}

// ============================================================================
// Shared Helpers
// ============================================================================

/**
 * Detect whether a message is SMS or WhatsApp based on phone number prefixes.
 */
function detectChannel(from: string, to: string): 'sms' | 'whatsapp' {
  if (from.startsWith('whatsapp:') || to.startsWith('whatsapp:')) {
    return 'whatsapp';
  }
  return 'sms';
}

/**
 * Convert a raw Twilio message to our clean format.
 */
export function formatMessage(raw: TwilioRawMessage): TwilioMessage {
  return {
    sid: raw.sid,
    from: raw.from,
    to: raw.to,
    body: raw.body,
    status: raw.status,
    direction: raw.direction,
    dateSent: raw.date_sent,
    dateCreated: raw.date_created,
    price: raw.price,
    priceUnit: raw.price_unit,
    numSegments: raw.num_segments,
    errorCode: raw.error_code,
    errorMessage: raw.error_message,
    channel: detectChannel(raw.from, raw.to),
  };
}
