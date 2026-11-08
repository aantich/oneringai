import { env } from '../infrastructure/runtime/environment.js';
/**
 * ErrorHandler - Centralized error handling for agents
 *
 * Provides consistent error handling, logging, and retry logic across all agent types.
 * This is an opt-in utility that agents can use for standardized error management.
 */

import { EventEmitter } from 'eventemitter3';
import { logger, FrameworkLogger } from '../infrastructure/observability/Logger.js';
import { metrics } from '../infrastructure/observability/Metrics.js';

/**
 * Context information for error handling
 */
export interface ErrorContext {
  /** Type of agent */
  agentType: 'agent' | 'task-agent' | 'universal-agent';

  /** Optional agent identifier */
  agentId?: string;

  /** Operation that failed */
  operation: string;

  /** Input that caused the error (optional, for debugging) */
  input?: unknown;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Configuration for ErrorHandler
 */
export interface ErrorHandlerConfig {
  /** Log errors to console/logger. Default: true */
  logErrors?: boolean;

  /** Include stack traces in logs. Default: true in development, false in production */
  includeStackTrace?: boolean;

  /** Custom error transformer */
  transformError?: (error: Error, context: ErrorContext) => Error;

  /** Error codes/messages that should be retried */
  retryablePatterns?: string[];

  /** Maximum retry attempts. Default: 3 */
  maxRetries?: number;

  /** Base delay for exponential backoff in ms. Default: 100 */
  baseRetryDelayMs?: number;

  /** Maximum retry delay in ms. Default: 5000 */
  maxRetryDelayMs?: number;
}

/**
 * Events emitted by ErrorHandler
 */
export interface ErrorHandlerEvents {
  /** Emitted when an error is handled */
  error: { error: Error; context: ErrorContext; recoverable: boolean };

  /** Emitted when retrying after an error */
  'error:retrying': { error: Error; context: ErrorContext; attempt: number; delayMs: number };

  /** Emitted when an error is fatal (no recovery possible) */
  'error:fatal': { error: Error; context: ErrorContext };
}

/**
 * Default retryable error patterns
 */
const DEFAULT_RETRYABLE_PATTERNS = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'rate limit',
  'Rate limit',
  '429',
  '500',
  '502',
  '503',
  '504',
  'timeout',
  'Timeout',
];

/**
 * Centralized error handling for all agent types.
 *
 * Features:
 * - Consistent error logging with context
 * - Automatic retry with exponential backoff
 * - Error classification (recoverable vs fatal)
 * - Metrics collection
 * - Event emission for monitoring
 *
 * @example
 * ```typescript
 * const errorHandler = new ErrorHandler({
 *   maxRetries: 3,
 *   logErrors: true,
 * });
 *
 * // Handle an error
 * errorHandler.handle(error, {
 *   agentType: 'agent',
 *   operation: 'run',
 * });
 *
 * // Execute with retry
 * const result = await errorHandler.executeWithRetry(
 *   () => riskyOperation(),
 *   { agentType: 'agent', operation: 'riskyOperation' }
 * );
 * ```
 */
export class ErrorHandler extends EventEmitter<ErrorHandlerEvents> {
  private config: Required<ErrorHandlerConfig>;
  private logger: FrameworkLogger;

  constructor(config: ErrorHandlerConfig = {}) {
    super();

    const isProduction = env('NODE_ENV') === 'production';

    this.config = {
      logErrors: config.logErrors ?? true,
      includeStackTrace: config.includeStackTrace ?? !isProduction,
      transformError: config.transformError ?? ((e) => e),
      retryablePatterns: config.retryablePatterns ?? DEFAULT_RETRYABLE_PATTERNS,
      maxRetries: config.maxRetries ?? 3,
      baseRetryDelayMs: config.baseRetryDelayMs ?? 100,
      maxRetryDelayMs: config.maxRetryDelayMs ?? 5000,
    };

    this.logger = logger.child({ component: 'ErrorHandler' });
  }

  /**
   * Handle an error with context.
   * Logs the error, emits events, and records metrics.
   *
   * @param error - The error to handle
   * @param context - Context information about where/how the error occurred
   */
  handle(error: Error, context: ErrorContext): void {
    const transformed = this.config.transformError(error, context);
    const recoverable = this.isRecoverable(transformed);

    // Log the error
    if (this.config.logErrors) {
      this.logError(transformed, context, recoverable);
    }

    // Record metrics
    this.recordMetrics(transformed, context, recoverable);

    // Emit events
    this.emit('error', { error: transformed, context, recoverable });

    if (!recoverable) {
      this.emit('error:fatal', { error: transformed, context });
    }
  }

  /**
   * Execute a function with automatic retry on retryable errors.
   *
   * @param fn - The function to execute
   * @param context - Context for error handling
   * @returns The result of the function
   * @throws The last error if all retries are exhausted
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    context: ErrorContext
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        // Check if we should retry
        const isLastAttempt = attempt === this.config.maxRetries;
        const shouldRetry = !isLastAttempt && this.isRetryable(lastError);

        if (!shouldRetry) {
          this.handle(lastError, context);
          throw lastError;
        }

        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateRetryDelay(attempt);

        // Emit retrying event
        this.emit('error:retrying', {
          error: lastError,
          context,
          attempt,
          delayMs: delay,
        });

        // Log retry
        if (this.config.logErrors) {
          this.logger.warn(
            {
              error: lastError.message,
              attempt,
              maxAttempts: this.config.maxRetries,
              delayMs: delay,
              ...this.contextToLogFields(context),
            },
            `Retrying after error (attempt ${attempt}/${this.config.maxRetries})`
          );
        }

        // Wait before retrying
        await this.delay(delay);
      }
    }

    // Should never reach here, but TypeScript needs this
    throw lastError;
  }

  /**
   * Wrap a function with error handling (no retry).
   * Useful for wrapping methods that already have their own retry logic.
   *
   * @param fn - The function to wrap
   * @param contextFactory - Factory to create context from function arguments
   * @returns A wrapped function with error handling
   */
  wrap<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => Promise<TResult>,
    contextFactory: (...args: TArgs) => ErrorContext
  ): (...args: TArgs) => Promise<TResult> {
    return async (...args: TArgs): Promise<TResult> => {
      try {
        return await fn(...args);
      } catch (error) {
        this.handle(error as Error, contextFactory(...args));
        throw error;
      }
    };
  }

  /**
   * Check if an error is recoverable (can be retried or handled gracefully).
   */
  isRecoverable(error: Error): boolean {
    // Network errors are often recoverable
    if (this.isRetryable(error)) {
      return true;
    }

    // Check for specific recoverable error types
    const recoverableTypes = [
      'RateLimitError',
      'TimeoutError',
      'NetworkError',
      'ConnectionError',
    ];

    return recoverableTypes.some(
      (type) => error.name === type || error.constructor.name === type
    );
  }

  /**
   * Check if an error should be retried.
   */
  isRetryable(error: Error): boolean {
    const errorString = `${error.name} ${error.message}`;
    return this.config.retryablePatterns.some((pattern) =>
      errorString.includes(pattern)
    );
  }

  /**
   * Add a retryable pattern.
   */
  addRetryablePattern(pattern: string): void {
    if (!this.config.retryablePatterns.includes(pattern)) {
      this.config.retryablePatterns.push(pattern);
    }
  }

  /**
   * Remove a retryable pattern.
   */
  removeRetryablePattern(pattern: string): void {
    const index = this.config.retryablePatterns.indexOf(pattern);
    if (index !== -1) {
      this.config.retryablePatterns.splice(index, 1);
    }
  }

  /**
   * Get current configuration (read-only).
   */
  getConfig(): Readonly<Required<ErrorHandlerConfig>> {
    return { ...this.config };
  }

  // ===== Private Helpers =====

  private logError(error: Error, context: ErrorContext, recoverable: boolean): void {
    const level = recoverable ? 'warn' : 'error';
    const logData = {
      error: error.message,
      errorName: error.name,
      recoverable,
      ...this.contextToLogFields(context),
    };

    if (this.config.includeStackTrace && error.stack) {
      (logData as any).stack = error.stack;
    }

    this.logger[level](logData, `Error in ${context.operation}`);
  }

  private contextToLogFields(context: ErrorContext): Record<string, unknown> {
    return {
      agentType: context.agentType,
      agentId: context.agentId,
      operation: context.operation,
      ...(context.metadata || {}),
    };
  }

  private recordMetrics(error: Error, context: ErrorContext, recoverable: boolean): void {
    metrics.increment('error.handled', 1, {
      agentType: context.agentType,
      operation: context.operation,
      errorType: error.name,
      recoverable: String(recoverable),
    });
  }

  private calculateRetryDelay(attempt: number): number {
    // Exponential backoff: base * 2^(attempt-1)
    const exponentialDelay = this.config.baseRetryDelayMs * Math.pow(2, attempt - 1);

    // Add jitter (±20%)
    const jitter = exponentialDelay * (0.8 + Math.random() * 0.4);

    // Cap at max delay
    return Math.min(jitter, this.config.maxRetryDelayMs);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Global error handler instance.
 * Can be used as a singleton for consistent error handling across the application.
 */
export const globalErrorHandler = new ErrorHandler();

export default ErrorHandler;
