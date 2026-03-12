/**
 * Token bucket rate limiter for LLM calls
 *
 * Implements a sliding window rate limiter to prevent hitting provider rate limits
 * during intensive plan execution.
 */

import { AIError } from '../../domain/errors/AIErrors.js';

/**
 * Error thrown when rate limit is exceeded and onLimit is 'throw'
 */
export class RateLimitError extends AIError {
  constructor(
    public readonly retryAfterMs: number,
    message?: string
  ) {
    super(message ?? `Rate limited. Retry after ${retryAfterMs}ms`, 'RATE_LIMIT_ERROR', 429);
    this.name = 'RateLimitError';
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

/**
 * Configuration for the rate limiter
 */
export interface RateLimiterConfig {
  /** Max requests allowed in window */
  maxRequests: number;

  /** Time window in ms (default: 60000 = 1 minute) */
  windowMs?: number;

  /** What to do when rate limited */
  onLimit: 'wait' | 'throw';

  /** Max wait time in ms (for 'wait' mode, default: 60000) */
  maxWaitMs?: number;

  /** Max queued waiters (default: 500). Rejects new requests when exceeded. */
  maxQueueSize?: number;
}

/**
 * Default rate limiter configuration
 */
export const DEFAULT_RATE_LIMITER_CONFIG: Required<RateLimiterConfig> = {
  maxRequests: 60,
  windowMs: 60000,
  onLimit: 'wait',
  maxWaitMs: 60000,
  maxQueueSize: 500,
};

/**
 * Rate limiter metrics
 */
export interface RateLimiterMetrics {
  /** Total requests made */
  totalRequests: number;
  /** Total requests throttled */
  throttledRequests: number;
  /** Total wait time in ms */
  totalWaitMs: number;
  /** Average wait time in ms */
  avgWaitMs: number;
}

/**
 * Token bucket rate limiter implementation
 *
 * Uses a sliding window approach where tokens are refilled completely
 * when the time window expires.
 */
export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly config: Required<RateLimiterConfig>;
  private waitQueue: Array<{
    resolve: () => void;
    reject: (e: Error) => void;
    timeout?: ReturnType<typeof setTimeout>;
  }> = [];

  // Metrics
  private totalRequests = 0;
  private throttledRequests = 0;
  private totalWaitMs = 0;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = {
      maxRequests: config.maxRequests ?? DEFAULT_RATE_LIMITER_CONFIG.maxRequests,
      windowMs: config.windowMs ?? DEFAULT_RATE_LIMITER_CONFIG.windowMs,
      onLimit: config.onLimit ?? DEFAULT_RATE_LIMITER_CONFIG.onLimit,
      maxWaitMs: config.maxWaitMs ?? DEFAULT_RATE_LIMITER_CONFIG.maxWaitMs,
      maxQueueSize: config.maxQueueSize ?? DEFAULT_RATE_LIMITER_CONFIG.maxQueueSize,
    };
    this.tokens = this.config.maxRequests;
    this.lastRefill = Date.now();
  }

  /**
   * Acquire a token (request permission to make an LLM call)
   * @returns Promise that resolves when token is acquired
   * @throws RateLimitError if onLimit='throw' and no tokens available
   */
  async acquire(): Promise<void> {
    this.totalRequests++;
    this.refill();

    if (this.tokens > 0) {
      this.tokens--;
      return;
    }

    // No tokens available
    this.throttledRequests++;
    const waitTime = this.getWaitTime();

    if (this.config.onLimit === 'throw') {
      throw new RateLimitError(waitTime);
    }

    // Wait mode — check queue capacity
    if (this.waitQueue.length >= this.config.maxQueueSize) {
      throw new RateLimitError(
        waitTime,
        `Rate limiter queue full (${this.config.maxQueueSize} waiters). Try again later.`
      );
    }

    if (waitTime > this.config.maxWaitMs) {
      throw new RateLimitError(
        waitTime,
        `Wait time ${waitTime}ms exceeds max ${this.config.maxWaitMs}ms`
      );
    }

    const startWait = Date.now();
    await this.waitForToken(waitTime);
    this.totalWaitMs += Date.now() - startWait;
  }

  /**
   * Try to acquire without waiting
   * @returns true if acquired, false if rate limited
   */
  tryAcquire(): boolean {
    this.totalRequests++;
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    this.throttledRequests++;
    return false;
  }

  /**
   * Get current available tokens
   */
  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Get time until next token is available
   */
  getWaitTime(): number {
    this.refill();
    if (this.tokens > 0) return 0;

    const elapsed = Date.now() - this.lastRefill;
    return Math.max(0, this.config.windowMs - elapsed);
  }

  /**
   * Get rate limiter metrics
   */
  getMetrics(): RateLimiterMetrics {
    return {
      totalRequests: this.totalRequests,
      throttledRequests: this.throttledRequests,
      totalWaitMs: this.totalWaitMs,
      avgWaitMs: this.throttledRequests > 0 ? this.totalWaitMs / this.throttledRequests : 0,
    };
  }

  /**
   * Reset the rate limiter state
   */
  reset(): void {
    this.tokens = this.config.maxRequests;
    this.lastRefill = Date.now();

    // Clear all waiting requests
    for (const waiter of this.waitQueue) {
      if (waiter.timeout) {
        clearTimeout(waiter.timeout);
      }
    }
    this.waitQueue = [];
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.totalRequests = 0;
    this.throttledRequests = 0;
    this.totalWaitMs = 0;
  }

  /**
   * Get the current configuration
   */
  getConfig(): Required<RateLimiterConfig> {
    return { ...this.config };
  }

  /**
   * Refill tokens if window has expired
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;

    if (elapsed >= this.config.windowMs) {
      // Full refill
      this.tokens = this.config.maxRequests;
      this.lastRefill = now;

      // Process waiting requests
      this.processWaitQueue();
    }
  }

  /**
   * Wait for a token to become available
   */
  private async waitForToken(waitTime: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Remove from queue
        const index = this.waitQueue.findIndex((w) => w.timeout === timeout);
        if (index !== -1) {
          this.waitQueue.splice(index, 1);
        }

        // Try to acquire after wait
        this.refill();
        if (this.tokens > 0) {
          this.tokens--;
          resolve();
        } else {
          // Still no tokens, this shouldn't happen but handle gracefully
          reject(new RateLimitError(this.getWaitTime(), 'Token still unavailable after wait'));
        }
      }, waitTime);

      this.waitQueue.push({ resolve, reject, timeout });
    });
  }

  /**
   * Process waiting requests when tokens become available
   */
  private processWaitQueue(): void {
    while (this.waitQueue.length > 0 && this.tokens > 0) {
      const waiter = this.waitQueue.shift();
      if (waiter) {
        if (waiter.timeout) {
          clearTimeout(waiter.timeout);
        }
        this.tokens--;
        waiter.resolve();
      }
    }
  }
}
