/**
 * Zoom Tools - Shared Types and Helpers
 *
 * Foundation for all Zoom connector tools.
 * Provides authenticated fetch, error handling, and result types.
 *
 * Key notes:
 * - Zoom returns standard HTTP status codes (unlike Slack)
 * - Pagination uses `next_page_token` field
 * - Meeting URLs contain the meeting ID: https://zoom.us/j/12345678901
 */

import type { Connector } from '../../core/Connector.js';

// ============================================================================
// Zoom API Helpers
// ============================================================================

/**
 * Options for zoomFetch
 */
export interface ZoomFetchOptions {
  method?: string;
  body?: Record<string, unknown>;
  userId?: string;
  accountId?: string;
  /** Query parameters appended to the URL */
  queryParams?: Record<string, string | number | boolean>;
}

/**
 * Error from Zoom API
 */
export class ZoomAPIError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode?: string,
    public readonly errorMessage?: string
  ) {
    const parts = [`Zoom API error ${statusCode}`];
    if (errorCode) parts.push(`(${errorCode})`);
    parts.push(`: ${errorMessage ?? 'Unknown error'}`);
    super(parts.join(''));
    this.name = 'ZoomAPIError';
  }
}

/**
 * Format any error caught in a Zoom tool's catch block into a detailed string.
 */
export function formatZoomToolError(prefix: string, error: unknown): string {
  if (error instanceof Error) {
    return `${prefix}: ${error.message}`;
  }
  return `${prefix}: ${String(error)}`;
}

/**
 * Make an authenticated Zoom API request through the connector.
 *
 * Handles Zoom's standard HTTP error responses.
 */
export async function zoomFetch<T = unknown>(
  connector: Connector,
  path: string,
  options?: ZoomFetchOptions
): Promise<T> {
  let url = path;

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
    headers['Content-Type'] = 'application/json';
    bodyStr = JSON.stringify(options.body);
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

  // 204 No Content — success with no body
  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();

  if (!response.ok) {
    let errorCode: string | undefined;
    let errorMessage: string | undefined;
    try {
      const err = JSON.parse(text);
      errorCode = String(err.code ?? '');
      errorMessage = err.message ?? '';
    } catch {
      errorMessage = text.slice(0, 500);
    }
    throw new ZoomAPIError(response.status, errorCode, errorMessage);
  }

  if (!text) {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ZoomAPIError(response.status, 'invalid_json', `Failed to parse response: ${text.slice(0, 500)}`);
  }
}

// ============================================================================
// Meeting URL Parser
// ============================================================================

/**
 * Extract a Zoom meeting ID from a URL or raw ID string.
 *
 * Supported formats:
 * - https://zoom.us/j/12345678901
 * - https://zoom.us/j/12345678901?pwd=abc
 * - https://us02web.zoom.us/j/12345678901
 * - 12345678901 (raw ID)
 */
export function parseMeetingId(input: string): string {
  const trimmed = input.trim();

  // Try URL pattern first
  const urlMatch = trimmed.match(/zoom\.us\/j\/(\d+)/i);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  // Raw numeric ID
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  throw new Error(`Cannot parse Zoom meeting ID from: "${input}". Provide a Zoom meeting URL (https://zoom.us/j/...) or a numeric meeting ID.`);
}

// ============================================================================
// VTT Transcript Parser
// ============================================================================

export interface TranscriptEntry {
  /** Speaker name */
  speaker: string;
  /** Start time in HH:MM:SS.mmm format */
  startTime: string;
  /** End time in HH:MM:SS.mmm format */
  endTime: string;
  /** Spoken text */
  text: string;
}

/**
 * Parse a WebVTT transcript into structured entries.
 *
 * Zoom VTT format:
 * ```
 * WEBVTT
 *
 * 1
 * 00:00:01.000 --> 00:00:05.000
 * Speaker Name: Hello everyone
 * ```
 */
export function parseVTT(vtt: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  // Split on double newlines to get cue blocks
  const blocks = vtt.split(/\n\s*\n/).filter((b) => b.trim());

  for (const block of blocks) {
    const lines = block.trim().split('\n');

    // Find the timestamp line
    let timestampIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.includes('-->')) {
        timestampIdx = i;
        break;
      }
    }

    if (timestampIdx === -1) continue;

    const timestampLine = lines[timestampIdx]!;
    const timeParts = timestampLine.split('-->').map((s) => s.trim());
    if (timeParts.length !== 2) continue;

    const startTime = timeParts[0]!;
    const endTime = timeParts[1]!;

    // Text lines come after the timestamp
    const textLines = lines.slice(timestampIdx + 1).join(' ').trim();
    if (!textLines) continue;

    // Extract speaker from "Speaker Name: text" pattern
    const speakerMatch = textLines.match(/^(.+?):\s+(.+)$/s);
    const speaker = speakerMatch?.[1]?.trim() ?? 'Unknown';
    const text = speakerMatch?.[2]?.trim() ?? textLines;

    entries.push({
      speaker,
      startTime,
      endTime,
      text,
    });
  }

  return entries;
}

// ============================================================================
// Result Types
// ============================================================================

export interface ZoomCreateMeetingResult {
  success: boolean;
  meetingId?: number;
  joinUrl?: string;
  startUrl?: string;
  topic?: string;
  startTime?: string;
  duration?: number;
  timezone?: string;
  password?: string;
  error?: string;
}

export interface ZoomUpdateMeetingResult {
  success: boolean;
  error?: string;
}

export interface ZoomGetTranscriptResult {
  success: boolean;
  meetingId?: string;
  meetingTopic?: string;
  transcript?: TranscriptEntry[];
  /** Full text with speaker labels, for easy consumption */
  fullText?: string;
  entryCount?: number;
  error?: string;
}

// ============================================================================
// Internal Zoom API Response Types
// ============================================================================

/** @internal */
export interface ZoomMeetingResponse {
  id: number;
  topic: string;
  type: number;
  start_time?: string;
  duration?: number;
  timezone?: string;
  join_url: string;
  start_url: string;
  password?: string;
  status?: string;
}

/** @internal */
export interface ZoomRecordingFile {
  id: string;
  meeting_id: string;
  recording_start: string;
  recording_end: string;
  file_type: string;
  file_extension?: string;
  file_size?: number;
  download_url: string;
  status: string;
  recording_type?: string;
}

/** @internal */
export interface ZoomRecordingsResponse {
  uuid: string;
  id: number;
  topic: string;
  start_time: string;
  duration: number;
  recording_files?: ZoomRecordingFile[];
}
