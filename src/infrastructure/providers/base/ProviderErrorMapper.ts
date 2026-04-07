/**
 * Unified error mapper for all providers
 * Converts provider-specific errors to our standard error types
 */

import {
  AIError,
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderContextLengthError,
  ProviderError,
} from '../../../domain/errors/AIErrors.js';
import { resolveMaxContextTokens } from './ModelCapabilityResolver.js';

export interface ProviderErrorContext {
  providerName: string;
  maxContextTokens?: number;
  model?: string;
}

/**
 * Maps provider-specific errors to our unified error types
 */
export class ProviderErrorMapper {
  /**
   * Map any provider error to our standard error types
   */
  static mapError(error: any, context: ProviderErrorContext): AIError {
    const { providerName, maxContextTokens, model } = context;
    const effectiveMaxTokens = model
      ? resolveMaxContextTokens(model, maxContextTokens ?? 128000)
      : (maxContextTokens ?? 128000);

    // Already our error type - return as-is
    if (error instanceof AIError) {
      return error;
    }

    // Extract error details
    const status = error.status || error.statusCode || error.code;
    const message = error.message || String(error);
    const messageLower = message.toLowerCase();

    // Auth errors (401, 403, or message indicators)
    if (
      status === 401 ||
      status === 403 ||
      messageLower.includes('api key') ||
      messageLower.includes('api_key') ||
      messageLower.includes('authentication') ||
      messageLower.includes('unauthorized') ||
      messageLower.includes('invalid key') ||
      messageLower.includes('permission denied')
    ) {
      return new ProviderAuthError(providerName, message);
    }

    // Rate limit errors (429 or message indicators)
    if (
      status === 429 ||
      messageLower.includes('rate limit') ||
      messageLower.includes('rate_limit') ||
      messageLower.includes('too many requests') ||
      messageLower.includes('resource exhausted') ||
      messageLower.includes('quota exceeded')
    ) {
      const retryAfter = this.extractRetryAfter(error);
      return new ProviderRateLimitError(providerName, retryAfter);
    }

    // Context length errors (413 or message indicators)
    if (
      status === 413 ||
      error.code === 'context_length_exceeded' ||
      messageLower.includes('context length') ||
      messageLower.includes('context_length') ||
      messageLower.includes('token limit') ||
      messageLower.includes('too long') ||
      messageLower.includes('maximum context') ||
      messageLower.includes('max_tokens') ||
      messageLower.includes('prompt is too long')
    ) {
      return new ProviderContextLengthError(providerName, effectiveMaxTokens);
    }

    // Generic provider error for everything else
    return new ProviderError(providerName, message, status, error);
  }

  /**
   * Extract retry-after value from error headers or body
   */
  private static extractRetryAfter(error: any): number | undefined {
    // Check headers (common for HTTP responses)
    const retryAfterHeader =
      error.headers?.['retry-after'] ||
      error.headers?.['Retry-After'] ||
      error.headers?.get?.('retry-after');

    if (retryAfterHeader) {
      const seconds = parseInt(retryAfterHeader, 10);
      if (!isNaN(seconds)) {
        return seconds * 1000; // Convert to milliseconds
      }
    }

    // Check error body for retry info
    if (error.retryAfter) {
      return typeof error.retryAfter === 'number'
        ? error.retryAfter
        : parseInt(error.retryAfter, 10) * 1000;
    }

    // Check for Google-style error details
    if (error.errorDetails) {
      for (const detail of error.errorDetails) {
        if (detail.retryDelay) {
          // Parse duration string like "60s"
          const match = detail.retryDelay.match(/(\d+)s/);
          if (match) {
            return parseInt(match[1], 10) * 1000;
          }
        }
      }
    }

    return undefined;
  }

  /**
   * Extract rich error details for logging.
   * Captures status, code, type, cause, headers, and stack from SDK errors.
   */
  static extractErrorDetails(error: any): Record<string, unknown> {
    const details: Record<string, unknown> = {
      error: error.message || String(error),
    };

    if (error.status != null) details.status = error.status;
    if (error.statusCode != null) details.statusCode = error.statusCode;
    if (error.code != null) details.code = error.code;
    if (error.type != null) details.type = error.type;
    if (error.param != null) details.param = error.param;

    // SDK-specific error body (OpenAI, Anthropic often put structured info here)
    if (error.error != null && typeof error.error === 'object') {
      details.errorBody = error.error;
    }

    // Google-style error details
    if (error.errorDetails != null) {
      details.errorDetails = error.errorDetails;
    }

    // Cause chain (Node.js Error.cause)
    if (error.cause != null) {
      const cause = error.cause;
      details.cause = cause.message || String(cause);
      if (cause.code != null) details.causeCode = cause.code;
      // Nested cause (e.g. ECONNREFUSED wrapped in fetch error)
      if (cause.cause != null) {
        const inner = cause.cause;
        details.innerCause = inner.message || String(inner);
        if (inner.code != null) details.innerCauseCode = inner.code;
      }
    }

    // Request URL if available (some SDKs attach it)
    if (error.url != null) details.url = error.url;

    // Stack trace (first 5 lines to keep logs readable)
    if (error.stack) {
      details.stack = error.stack.split('\n').slice(0, 5).join('\n');
    }

    return details;
  }
}
