/**
 * Generic Circuit Breaker implementation
 *
 * Prevents cascading failures by failing fast when a system is down.
 * Works for any async operation (LLM calls, tool execution, etc.)
 */

import { EventEmitter } from 'eventemitter3';

/**
 * Circuit breaker states
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Failure record for window tracking
 */
interface FailureRecord {
  timestamp: number;
  error: string;
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;

  /** Number of successes to close from half-open */
  successThreshold: number;

  /** Time to wait in open state before trying half-open (ms) */
  resetTimeoutMs: number;

  /** Time window for counting failures (ms) */
  windowMs: number;

  /** Classify errors - return true if error should count as failure */
  isRetryable?: (error: Error) => boolean;
}

/**
 * Circuit breaker metrics
 */
export interface CircuitBreakerMetrics {
  name: string;
  state: CircuitState;

  // Counters
  totalRequests: number;
  successCount: number;
  failureCount: number;
  rejectedCount: number; // Rejected by open circuit

  // Current window
  recentFailures: number;
  consecutiveSuccesses: number;

  // Timestamps
  lastFailureTime?: number;
  lastSuccessTime?: number;
  lastStateChange: number;
  nextRetryTime?: number;

  // Rates
  failureRate: number;
  successRate: number;
}

/**
 * Circuit breaker events
 */
export interface CircuitBreakerEvents {
  opened: { name: string; failureCount: number; lastError: string; nextRetryTime: number };
  'half-open': { name: string; timestamp: number };
  closed: { name: string; successCount: number; timestamp: number };
}

/**
 * Default configuration
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  resetTimeoutMs: 30000, // 30 seconds
  windowMs: 60000, // 1 minute
  isRetryable: () => true, // All errors count by default
};

/**
 * Circuit breaker error - thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  constructor(
    public readonly breakerName: string,
    public readonly nextRetryTime: number,
    public readonly failureCount: number,
    public readonly lastError: string
  ) {
    const retryInSeconds = Math.ceil((nextRetryTime - Date.now()) / 1000);
    super(
      `Circuit breaker '${breakerName}' is OPEN. ` +
      `Retry in ${retryInSeconds}s. ` +
      `(${failureCount} recent failures, last: ${lastError})`
    );
    this.name = 'CircuitOpenError';
  }
}

/**
 * Generic circuit breaker for any async operation
 */
export class CircuitBreaker<T = any> extends EventEmitter<CircuitBreakerEvents> {
  private state: CircuitState = 'closed';
  private config: CircuitBreakerConfig;

  // Failure tracking
  private failures: FailureRecord[] = [];
  private lastError: string = '';

  // Success tracking
  private consecutiveSuccesses = 0;

  // Timing
  private openedAt?: number;
  private lastStateChange: number;

  // Metrics
  private totalRequests = 0;
  private successCount = 0;
  private failureCount = 0;
  private rejectedCount = 0;
  private lastFailureTime?: number;
  private lastSuccessTime?: number;

  constructor(
    public readonly name: string,
    config: Partial<CircuitBreakerConfig> = {}
  ) {
    super();
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
    this.lastStateChange = Date.now();
  }

  /**
   * Execute function with circuit breaker protection
   */
  async execute(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++;

    // Check circuit state
    const now = Date.now();

    switch (this.state) {
      case 'open':
        // Check if timeout has expired
        if (this.openedAt && now - this.openedAt >= this.config.resetTimeoutMs) {
          // Transition to half-open
          this.transitionTo('half-open');
        } else {
          // Still open, reject immediately
          this.rejectedCount++;
          const nextRetry = (this.openedAt || now) + this.config.resetTimeoutMs;
          throw new CircuitOpenError(this.name, nextRetry, this.failures.length, this.lastError);
        }
        break;

      case 'half-open':
        // Allow one request through
        break;

      case 'closed':
        // Normal operation
        break;
    }

    // Execute the function
    try {
      const result = await fn();

      // Success - record it
      this.recordSuccess();

      return result;
    } catch (error) {
      // Failure - record it
      this.recordFailure(error as Error);

      throw error;
    }
  }

  /**
   * Record successful execution
   */
  private recordSuccess(): void {
    this.successCount++;
    this.lastSuccessTime = Date.now();
    this.consecutiveSuccesses++;

    if (this.state === 'half-open') {
      // Check if enough successes to close
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.transitionTo('closed');
      }
    } else if (this.state === 'closed') {
      // Clean up old failures on success
      this.pruneOldFailures();
    }
  }

  /**
   * Record failed execution
   */
  private recordFailure(error: Error): void {
    // Check if error should count as failure
    if (this.config.isRetryable && !this.config.isRetryable(error)) {
      // Non-retryable error, don't count toward circuit breaker
      return;
    }

    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.lastError = error.message;

    // Reset consecutive successes
    this.consecutiveSuccesses = 0;

    // Record failure
    this.failures.push({
      timestamp: Date.now(),
      error: error.message,
    });

    // Prune old failures outside window
    this.pruneOldFailures();

    // Check if we should open the circuit
    if (this.state === 'half-open') {
      // Failure during half-open → back to open
      this.transitionTo('open');
    } else if (this.state === 'closed') {
      // Check failure threshold
      if (this.failures.length >= this.config.failureThreshold) {
        this.transitionTo('open');
      }
    }
  }

  /**
   * Transition to new state
   */
  private transitionTo(newState: CircuitState): void {
    this.state = newState;
    this.lastStateChange = Date.now();

    switch (newState) {
      case 'open':
        this.openedAt = Date.now();
        this.emit('opened', {
          name: this.name,
          failureCount: this.failures.length,
          lastError: this.lastError,
          nextRetryTime: this.openedAt + this.config.resetTimeoutMs,
        });
        break;

      case 'half-open':
        this.emit('half-open', {
          name: this.name,
          timestamp: Date.now(),
        });
        break;

      case 'closed': {
        // Capture before reset so event carries the actual success count
        const capturedSuccesses = this.consecutiveSuccesses;

        // Reset state
        this.failures = [];
        this.consecutiveSuccesses = 0;
        this.openedAt = undefined;

        this.emit('closed', {
          name: this.name,
          successCount: capturedSuccesses,
          timestamp: Date.now(),
        });
        break;
      }
    }
  }

  /**
   * Remove failures outside the time window and cap array size
   */
  private pruneOldFailures(): void {
    const now = Date.now();
    const cutoff = now - this.config.windowMs;
    this.failures = this.failures.filter((f) => f.timestamp > cutoff);

    // Cap failures array to prevent unbounded growth
    const maxFailures = Math.max(this.config.failureThreshold * 2, 20);
    if (this.failures.length > maxFailures) {
      this.failures = this.failures.slice(-maxFailures);
    }
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get current metrics
   */
  getMetrics(): CircuitBreakerMetrics {
    this.pruneOldFailures();

    const total = this.successCount + this.failureCount;
    const failureRate = total > 0 ? this.failureCount / total : 0;
    const successRate = total > 0 ? this.successCount / total : 0;

    return {
      name: this.name,
      state: this.state,
      totalRequests: this.totalRequests,
      successCount: this.successCount,
      failureCount: this.failureCount,
      rejectedCount: this.rejectedCount,
      recentFailures: this.failures.length,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      lastStateChange: this.lastStateChange,
      nextRetryTime: this.openedAt ? this.openedAt + this.config.resetTimeoutMs : undefined,
      failureRate,
      successRate,
    };
  }

  /**
   * Manually reset circuit breaker (force close)
   */
  reset(): void {
    this.transitionTo('closed');
    this.totalRequests = 0;
    this.successCount = 0;
    this.failureCount = 0;
    this.rejectedCount = 0;
    this.lastFailureTime = undefined;
    this.lastSuccessTime = undefined;
  }

  /**
   * Check if circuit is allowing requests
   */
  isOpen(): boolean {
    if (this.state === 'open' && this.openedAt) {
      const now = Date.now();
      if (now - this.openedAt >= this.config.resetTimeoutMs) {
        // Should transition to half-open
        this.transitionTo('half-open');
        return false;
      }
      return true;
    }
    return false;
  }

  /**
   * Get configuration
   */
  getConfig(): CircuitBreakerConfig {
    return { ...this.config };
  }
}
