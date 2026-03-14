/**
 * Circuit Breaker Edge Case Tests
 *
 * Covers edge cases NOT in the main CircuitBreaker.test.ts:
 * - Listener count bounds
 * - reset() clearing all state
 * - High failure counts and bounded state
 * - Concurrent half-open behavior
 * - Error message quality
 * - Rapid open/close cycles
 * - Zero timeout recovery
 */

import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../../../src/infrastructure/resilience/CircuitBreaker.js';

describe('CircuitBreaker Edge Cases', () => {
  describe('EventEmitter listener count stays bounded', () => {
    it('should not accumulate listeners after many state transitions', async () => {
      const breaker = new CircuitBreaker('listener-test', {
        failureThreshold: 1,
        successThreshold: 1,
        resetTimeoutMs: 1, // 1ms for fast transitions
        windowMs: 60000,
      });

      const handler = vi.fn();
      breaker.on('opened', handler);
      breaker.on('half-open', handler);
      breaker.on('closed', handler);

      // Cycle through open/half-open/closed many times
      for (let i = 0; i < 20; i++) {
        // Fail to open
        await expect(
          breaker.execute(() => Promise.reject(new Error('fail')))
        ).rejects.toThrow();

        // Wait for half-open
        await new Promise((r) => setTimeout(r, 5));

        // Succeed to close
        await breaker.execute(() => Promise.resolve('ok'));
      }

      // Listeners should still be exactly 1 per event (no accumulation)
      expect(breaker.listenerCount('opened')).toBe(1);
      expect(breaker.listenerCount('half-open')).toBe(1);
      expect(breaker.listenerCount('closed')).toBe(1);

      // Handler was called for each transition
      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(40);
    });
  });

  describe('reset() clears all state including failure records', () => {
    it('should clear all counters, timestamps, and failure records', async () => {
      const breaker = new CircuitBreaker('reset-test', {
        failureThreshold: 2,
        successThreshold: 1,
        resetTimeoutMs: 10000,
        windowMs: 60000,
      });

      // Generate some state
      await breaker.execute(() => Promise.resolve('ok'));
      await expect(
        breaker.execute(() => Promise.reject(new Error('fail')))
      ).rejects.toThrow();
      await expect(
        breaker.execute(() => Promise.reject(new Error('fail')))
      ).rejects.toThrow();

      expect(breaker.getState()).toBe('open');

      breaker.reset();

      const metrics = breaker.getMetrics();
      expect(metrics.state).toBe('closed');
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.successCount).toBe(0);
      expect(metrics.failureCount).toBe(0);
      expect(metrics.rejectedCount).toBe(0);
      expect(metrics.recentFailures).toBe(0);
      expect(metrics.consecutiveSuccesses).toBe(0);
      expect(metrics.lastFailureTime).toBeUndefined();
      expect(metrics.lastSuccessTime).toBeUndefined();
      expect(metrics.nextRetryTime).toBeUndefined();
    });

    it('should allow normal operation after reset from open state', async () => {
      const breaker = new CircuitBreaker('reset-resume', {
        failureThreshold: 2,
        successThreshold: 1,
        resetTimeoutMs: 999999,
        windowMs: 60000,
      });

      // Open circuit
      await expect(breaker.execute(() => Promise.reject(new Error('f')))).rejects.toThrow();
      await expect(breaker.execute(() => Promise.reject(new Error('f')))).rejects.toThrow();
      expect(breaker.getState()).toBe('open');

      breaker.reset();

      // Should work immediately without waiting
      const result = await breaker.execute(() => Promise.resolve('recovered'));
      expect(result).toBe('recovered');
    });
  });

  describe('very high failure count — internal state stays bounded', () => {
    it('should cap failure records and not grow unbounded', async () => {
      const breaker = new CircuitBreaker('high-fail', {
        failureThreshold: 5,
        successThreshold: 1,
        resetTimeoutMs: 1, // 1ms to allow quick recovery
        windowMs: 60000,
      });

      // Generate many failures by cycling open/half-open
      for (let i = 0; i < 100; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error(`fail-${i}`)));
        } catch {
          // expected
        }

        // If open, wait and let it go half-open then fail again
        if (breaker.getState() === 'open') {
          await new Promise((r) => setTimeout(r, 5));
        }
      }

      const metrics = breaker.getMetrics();
      // recentFailures should be capped (max = max(failureThreshold*2, 20) = 20)
      expect(metrics.recentFailures).toBeLessThanOrEqual(20);
    });
  });

  describe('concurrent execute() calls during half-open', () => {
    it('should allow calls through in half-open state', async () => {
      const breaker = new CircuitBreaker('concurrent-half-open', {
        failureThreshold: 2,
        successThreshold: 2,
        resetTimeoutMs: 50,
        windowMs: 60000,
      });

      // Open circuit
      await expect(breaker.execute(() => Promise.reject(new Error('f')))).rejects.toThrow();
      await expect(breaker.execute(() => Promise.reject(new Error('f')))).rejects.toThrow();
      expect(breaker.getState()).toBe('open');

      // Wait for half-open
      await new Promise((r) => setTimeout(r, 80));

      // Launch concurrent calls — some may succeed, some may fail
      // The key property is that the circuit breaker does not crash or deadlock
      const results = await Promise.allSettled([
        breaker.execute(() => new Promise((r) => setTimeout(() => r('a'), 10))),
        breaker.execute(() => new Promise((r) => setTimeout(() => r('b'), 10))),
        breaker.execute(() => new Promise((r) => setTimeout(() => r('c'), 10))),
      ]);

      // At least one should have been executed (not rejected by CircuitOpenError)
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('CircuitOpenError message quality', () => {
    it('should include breaker name, retry info, failure count, and last error', async () => {
      const breaker = new CircuitBreaker('my-service', {
        failureThreshold: 2,
        successThreshold: 1,
        resetTimeoutMs: 5000,
        windowMs: 60000,
      });

      await expect(
        breaker.execute(() => Promise.reject(new Error('connection refused')))
      ).rejects.toThrow();
      await expect(
        breaker.execute(() => Promise.reject(new Error('connection refused')))
      ).rejects.toThrow();

      try {
        await breaker.execute(() => Promise.resolve('ok'));
        throw new Error('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CircuitOpenError);
        const coe = err as CircuitOpenError;

        // Check structured fields
        expect(coe.breakerName).toBe('my-service');
        expect(coe.failureCount).toBe(2);
        expect(coe.lastError).toBe('connection refused');
        expect(coe.nextRetryTime).toBeGreaterThan(Date.now());

        // Check human-readable message
        expect(coe.message).toContain('my-service');
        expect(coe.message).toContain('OPEN');
        expect(coe.message).toContain('Retry in');
        expect(coe.message).toContain('connection refused');
        expect(coe.message).toContain('2 recent failures');
      }
    });

    it('should have name property set to CircuitOpenError', async () => {
      const breaker = new CircuitBreaker('err-name', {
        failureThreshold: 1,
        successThreshold: 1,
        resetTimeoutMs: 10000,
        windowMs: 60000,
      });

      await expect(breaker.execute(() => Promise.reject(new Error('x')))).rejects.toThrow();

      try {
        await breaker.execute(() => Promise.resolve('ok'));
      } catch (err) {
        expect((err as Error).name).toBe('CircuitOpenError');
      }
    });
  });

  describe('state after many rapid open/close cycles', () => {
    it('should be in a valid state after rapid cycling', async () => {
      const breaker = new CircuitBreaker('rapid-cycle', {
        failureThreshold: 1,
        successThreshold: 1,
        resetTimeoutMs: 1,
        windowMs: 60000,
      });

      for (let i = 0; i < 50; i++) {
        // Fail to open
        await expect(
          breaker.execute(() => Promise.reject(new Error('fail')))
        ).rejects.toThrow();

        // Wait briefly for half-open
        await new Promise((r) => setTimeout(r, 5));

        // Succeed to close
        await breaker.execute(() => Promise.resolve('ok'));
      }

      // Should end in closed state
      expect(breaker.getState()).toBe('closed');

      // Metrics should be consistent
      const metrics = breaker.getMetrics();
      expect(metrics.successCount).toBeGreaterThanOrEqual(50);
      expect(metrics.failureCount).toBeGreaterThanOrEqual(50);
      expect(['closed', 'half-open', 'open']).toContain(metrics.state);
    });
  });

  describe('circuit with 0 timeout — immediate recovery attempt', () => {
    it('should transition to half-open immediately with resetTimeoutMs=0', async () => {
      const breaker = new CircuitBreaker('zero-timeout', {
        failureThreshold: 2,
        successThreshold: 1,
        resetTimeoutMs: 0,
        windowMs: 60000,
      });

      // Open the circuit
      await expect(breaker.execute(() => Promise.reject(new Error('f')))).rejects.toThrow();
      await expect(breaker.execute(() => Promise.reject(new Error('f')))).rejects.toThrow();
      expect(breaker.getState()).toBe('open');

      // With 0 timeout, the very next execute should transition to half-open and succeed
      const result = await breaker.execute(() => Promise.resolve('immediate-recovery'));
      expect(result).toBe('immediate-recovery');
      expect(breaker.getState()).toBe('closed');
    });
  });

  describe('isOpen() triggers half-open transition', () => {
    it('should return false and transition to half-open after timeout', async () => {
      const breaker = new CircuitBreaker('is-open-transition', {
        failureThreshold: 2,
        successThreshold: 1,
        resetTimeoutMs: 50,
        windowMs: 60000,
      });

      // Open the circuit
      await expect(breaker.execute(() => Promise.reject(new Error('f')))).rejects.toThrow();
      await expect(breaker.execute(() => Promise.reject(new Error('f')))).rejects.toThrow();
      expect(breaker.isOpen()).toBe(true);

      // Wait past the timeout
      await new Promise((r) => setTimeout(r, 80));

      // isOpen() should trigger transition to half-open and return false
      expect(breaker.isOpen()).toBe(false);
      expect(breaker.getState()).toBe('half-open');
    });
  });

  describe('metrics after mixed operations', () => {
    it('should track failure rate and success rate accurately', async () => {
      const breaker = new CircuitBreaker('rates', {
        failureThreshold: 100, // High threshold to stay closed
        successThreshold: 1,
        resetTimeoutMs: 10000,
        windowMs: 60000,
      });

      // 7 successes, 3 failures
      for (let i = 0; i < 7; i++) {
        await breaker.execute(() => Promise.resolve('ok'));
      }
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error('f')))).rejects.toThrow();
      }

      const metrics = breaker.getMetrics();
      expect(metrics.successCount).toBe(7);
      expect(metrics.failureCount).toBe(3);
      expect(metrics.successRate).toBeCloseTo(0.7);
      expect(metrics.failureRate).toBeCloseTo(0.3);
    });
  });
});
