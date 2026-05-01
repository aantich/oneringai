/**
 * Base text provider with common text generation functionality
 */

import { BaseProvider } from './BaseProvider.js';
import { ITextProvider, ModelCapabilities, TextGenerateOptions } from '../../../domain/interfaces/ITextProvider.js';
import { LLMResponse } from '../../../domain/entities/Response.js';
import { StreamEvent } from '../../../domain/entities/StreamEvent.js';
import { CircuitBreaker, DEFAULT_CIRCUIT_BREAKER_CONFIG } from '../../resilience/CircuitBreaker.js';
import { logger, FrameworkLogger } from '../../observability/Logger.js';
import { metrics } from '../../observability/Metrics.js';
import type { IDisposable } from '../../../domain/interfaces/IDisposable.js';
import { enforceContextLimit } from '../shared/enforceContextLimit.js';

export abstract class BaseTextProvider extends BaseProvider implements ITextProvider, IDisposable {
  protected circuitBreaker?: CircuitBreaker;
  protected logger: FrameworkLogger;
  private _isObservabilityInitialized = false;
  private _isDestroyed = false;

  constructor(config: any) {
    super(config);

    // Initialize with default logger (will be updated with provider name on first use)
    this.logger = logger.child({
      component: 'Provider',
      provider: 'unknown',
    });

    // Circuit breaker created lazily on first use
  }

  /**
   * Auto-initialize observability on first use (lazy initialization)
   * This is called automatically by executeWithCircuitBreaker(); subclasses
   * whose stream paths bypass it (e.g. streamGenerate) should also call it
   * at entry so error logs carry the real provider name instead of "unknown".
   * @internal
   */
  protected ensureObservabilityInitialized(): void {
    if (this._isObservabilityInitialized || this._isDestroyed) {
      return;
    }

    const providerName = this.name || 'unknown';

    // Create circuit breaker with provider name
    const cbConfig = (this.config as any).circuitBreaker || DEFAULT_CIRCUIT_BREAKER_CONFIG;
    this.circuitBreaker = new CircuitBreaker(
      `provider:${providerName}`,
      cbConfig
    );

    // Update logger with provider name
    this.logger = logger.child({
      component: 'Provider',
      provider: providerName,
    });

    // Forward circuit breaker events to metrics
    this.circuitBreaker.on('opened', (data) => {
      this.logger.warn(data, 'Circuit breaker opened');
      metrics.increment('circuit_breaker.opened', 1, {
        breaker: data.name,
        provider: providerName,
      });
    });

    this.circuitBreaker.on('closed', (data) => {
      this.logger.info(data, 'Circuit breaker closed');
      metrics.increment('circuit_breaker.closed', 1, {
        breaker: data.name,
        provider: providerName,
      });
    });

    this._isObservabilityInitialized = true;
  }

  /**
   * DEPRECATED: No longer needed, kept for backward compatibility
   * Observability is now auto-initialized on first use
   * @deprecated Initialization happens automatically
   */
  protected initializeObservability(_providerName: string): void {
    // Force initialization now (for providers that still call this)
    this.ensureObservabilityInitialized();
  }

  abstract generate(options: TextGenerateOptions): Promise<LLMResponse>;
  abstract streamGenerate(options: TextGenerateOptions): AsyncIterableIterator<StreamEvent>;
  abstract getModelCapabilities(model: string): ModelCapabilities;

  /**
   * Execute with circuit breaker protection (helper for subclasses)
   */
  protected async executeWithCircuitBreaker<TResult>(
    operation: () => Promise<TResult>,
    model?: string
  ): Promise<TResult> {
    // Auto-initialize observability on first use
    this.ensureObservabilityInitialized();

    const startTime = Date.now();
    const operationName = 'llm.generate';

    this.logger.debug({
      operation: operationName,
      model,
    }, 'LLM call started');

    metrics.increment('provider.llm.request', 1, {
      provider: this.name,
      model: model || 'unknown',
    });

    try {
      // Execute with circuit breaker (should always be initialized after ensureObservabilityInitialized)
      if (!this.circuitBreaker) {
        // Fallback: execute without circuit breaker (should never happen)
        return await operation();
      }

      const result = await this.circuitBreaker.execute(operation);

      const duration = Date.now() - startTime;

      this.logger.info({
        operation: operationName,
        model,
        duration,
      }, 'LLM call completed');

      metrics.timing('provider.llm.latency', duration, {
        provider: this.name,
        model: model || 'unknown',
      });

      metrics.increment('provider.llm.response', 1, {
        provider: this.name,
        model: model || 'unknown',
        status: 'success',
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error({
        operation: operationName,
        model,
        error: (error as Error).message,
        duration,
      }, 'LLM call failed');

      metrics.increment('provider.llm.error', 1, {
        provider: this.name,
        model: model || 'unknown',
        error: (error as Error).name,
      });

      throw error;
    }
  }

  /**
   * Get circuit breaker metrics
   */
  getCircuitBreakerMetrics() {
    if (!this.circuitBreaker) {
      // Not yet initialized (no calls made yet)
      return null;
    }
    return this.circuitBreaker.getMetrics();
  }

  /**
   * Normalize input to string (helper for providers that don't support complex input)
   */
  protected normalizeInputToString(input: string | any[]): string {
    if (typeof input === 'string') {
      return input;
    }

    // Extract text from InputItem array
    const textParts: string[] = [];
    for (const item of input) {
      if (item.type === 'message') {
        for (const content of item.content) {
          if (content.type === 'input_text') {
            textParts.push(content.text);
          } else if (content.type === 'output_text') {
            textParts.push(content.text);
          }
        }
      }
    }

    return textParts.join('\n');
  }

  /**
   * Apply context limit guardrail to generation options.
   * Returns the same options if within budget, or trimmed options if over.
   * This is a safety net — primary context management is in AgentContextNextGen.
   */
  protected applyContextLimitGuardrail(options: TextGenerateOptions): TextGenerateOptions {
    if (options.skipContextLimitCheck) return options;
    const capabilities = this.getModelCapabilities(options.model);
    return enforceContextLimit(options, capabilities, this.logger);
  }

  /**
   * List available models from the provider's API.
   * Default returns empty array; providers override when they have SDK support.
   */
  async listModels(): Promise<string[]> {
    return [];
  }

  /**
   * Check if the provider has been destroyed
   */
  get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  /**
   * Clean up provider resources (circuit breaker listeners, etc.)
   * Should be called when the provider is no longer needed.
   */
  destroy(): void {
    if (this._isDestroyed) return;
    this._isDestroyed = true;

    if (this.circuitBreaker) {
      this.circuitBreaker.removeAllListeners();
      this.circuitBreaker = undefined;
    }
    this._isObservabilityInitialized = false;
  }
}
