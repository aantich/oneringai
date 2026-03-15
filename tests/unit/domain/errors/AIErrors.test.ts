/**
 * AIErrors - Unit Tests
 *
 * Tests all custom error classes for correct name, instanceof, stack traces,
 * error wrapping, serialization, and domain-specific properties.
 */

import { describe, it, expect } from 'vitest';
import {
  AIError,
  ProviderNotFoundError,
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderContextLengthError,
  ToolExecutionError,
  ToolTimeoutError,
  ToolNotFoundError,
  ModelNotSupportedError,
  InvalidConfigError,
  InvalidToolArgumentsError,
  ProviderError,
  DependencyCycleError,
  TaskTimeoutError,
  TaskValidationError,
  ParallelTasksError,
  DocumentReadError,
  UnsupportedFormatError,
  ContextOverflowError,
} from '@/domain/errors/AIErrors.js';

describe('AIErrors', () => {
  describe('Error name property', () => {
    it('should have correct name for all error classes', () => {
      expect(new AIError('msg', 'CODE').name).toBe('AIError');
      expect(new ProviderNotFoundError('openai').name).toBe('ProviderNotFoundError');
      expect(new ProviderAuthError('openai').name).toBe('ProviderAuthError');
      expect(new ProviderRateLimitError('openai').name).toBe('ProviderRateLimitError');
      expect(new ProviderContextLengthError('openai', 4096).name).toBe('ProviderContextLengthError');
      expect(new ToolExecutionError('tool', 'failed').name).toBe('ToolExecutionError');
      expect(new ToolTimeoutError('tool', 5000).name).toBe('ToolTimeoutError');
      expect(new ToolNotFoundError('tool').name).toBe('ToolNotFoundError');
      expect(new ModelNotSupportedError('openai', 'gpt-4', 'streaming').name).toBe('ModelNotSupportedError');
      expect(new InvalidConfigError('bad config').name).toBe('InvalidConfigError');
      expect(new InvalidToolArgumentsError('tool', '{bad}').name).toBe('InvalidToolArgumentsError');
      expect(new ProviderError('openai', 'error').name).toBe('ProviderError');
      expect(new DependencyCycleError(['A', 'B', 'A']).name).toBe('DependencyCycleError');
      expect(new TaskTimeoutError('t1', 'task1', 5000).name).toBe('TaskTimeoutError');
      expect(new TaskValidationError('t1', 'task1', 'invalid').name).toBe('TaskValidationError');
      expect(new ParallelTasksError([]).name).toBe('ParallelTasksError');
      expect(new DocumentReadError('file.pdf', 'corrupt').name).toBe('DocumentReadError');
      expect(new UnsupportedFormatError('.xyz').name).toBe('UnsupportedFormatError');
      expect(
        new ContextOverflowError('too big', {
          actualTokens: 200000,
          maxTokens: 128000,
          overageTokens: 72000,
          breakdown: {},
          degradationLog: [],
        }).name,
      ).toBe('ContextOverflowError');
    });
  });

  describe('instanceof checks', () => {
    it('should be instanceof Error', () => {
      expect(new AIError('msg', 'CODE')).toBeInstanceOf(Error);
      expect(new ProviderAuthError('openai')).toBeInstanceOf(Error);
      expect(new ToolExecutionError('tool', 'msg')).toBeInstanceOf(Error);
    });

    it('should be instanceof AIError', () => {
      expect(new ProviderNotFoundError('openai')).toBeInstanceOf(AIError);
      expect(new ProviderAuthError('openai')).toBeInstanceOf(AIError);
      expect(new ProviderRateLimitError('openai')).toBeInstanceOf(AIError);
      expect(new ToolExecutionError('tool', 'msg')).toBeInstanceOf(AIError);
      expect(new ToolTimeoutError('tool', 5000)).toBeInstanceOf(AIError);
      expect(new DependencyCycleError(['A', 'B'])).toBeInstanceOf(AIError);
      expect(new ContextOverflowError('overflow', {
        actualTokens: 1, maxTokens: 1, overageTokens: 0,
        breakdown: {}, degradationLog: [],
      })).toBeInstanceOf(AIError);
    });

    it('should be instanceof their own class', () => {
      expect(new ProviderAuthError('openai')).toBeInstanceOf(ProviderAuthError);
      expect(new ToolExecutionError('t', 'm')).toBeInstanceOf(ToolExecutionError);
      expect(new ProviderRateLimitError('openai', 1000)).toBeInstanceOf(ProviderRateLimitError);
    });
  });

  describe('Stack trace', () => {
    it('should preserve stack trace for all error types', () => {
      const errors = [
        new AIError('msg', 'CODE'),
        new ProviderAuthError('openai'),
        new ToolExecutionError('tool', 'failed'),
        new ToolTimeoutError('tool', 5000),
        new DependencyCycleError(['A', 'B', 'A']),
      ];

      for (const error of errors) {
        expect(error.stack).toBeDefined();
        expect(error.stack).toContain('AIErrors.test.ts');
      }
    });
  });

  describe('ToolExecutionError', () => {
    it('should wrap the original error', () => {
      const original = new Error('Root cause');
      const toolError = new ToolExecutionError('my_tool', 'Something broke', original);

      expect(toolError.originalError).toBe(original);
      expect(toolError.message).toContain('my_tool');
      expect(toolError.message).toContain('Something broke');
      expect(toolError.code).toBe('TOOL_EXECUTION_ERROR');
      expect(toolError.statusCode).toBe(500);
    });

    it('should work without original error', () => {
      const toolError = new ToolExecutionError('my_tool', 'No root cause');
      expect(toolError.originalError).toBeUndefined();
      expect(toolError.message).toContain('my_tool');
    });
  });

  describe('Error serialization (JSON.stringify)', () => {
    it('should serialize AIError with code and statusCode', () => {
      const error = new AIError('test message', 'TEST_CODE', 418);
      const json = JSON.parse(JSON.stringify(error));

      expect(json.code).toBe('TEST_CODE');
      expect(json.statusCode).toBe(418);
    });

    it('should serialize ProviderRateLimitError with retryAfter', () => {
      const error = new ProviderRateLimitError('openai', 5000);
      const json = JSON.parse(JSON.stringify(error));

      expect(json.retryAfter).toBe(5000);
    });

    it('should serialize DependencyCycleError with cycle array', () => {
      const error = new DependencyCycleError(['A', 'B', 'C', 'A'], 'plan-1');
      const json = JSON.parse(JSON.stringify(error));

      expect(json.cycle).toEqual(['A', 'B', 'C', 'A']);
      expect(json.planId).toBe('plan-1');
    });

    it('should serialize ParallelTasksError with failures', () => {
      const failures = [
        { taskId: 't1', taskName: 'task1', error: new Error('fail1') },
        { taskId: 't2', taskName: 'task2', error: new Error('fail2') },
      ];
      const error = new ParallelTasksError(failures);
      const json = JSON.parse(JSON.stringify(error));

      expect(json.failures).toHaveLength(2);
    });
  });

  describe('ProviderAuthError', () => {
    it('should include provider name in message', () => {
      const error = new ProviderAuthError('anthropic', 'Invalid API key');
      expect(error.message).toContain('anthropic');
      expect(error.message).toContain('Invalid API key');
      expect(error.code).toBe('PROVIDER_AUTH_ERROR');
      expect(error.statusCode).toBe(401);
    });

    it('should use default message when none provided', () => {
      const error = new ProviderAuthError('openai');
      expect(error.message).toContain('openai');
      expect(error.message).toContain('Authentication failed');
    });
  });

  describe('ProviderRateLimitError', () => {
    it('should include retry info when provided', () => {
      const error = new ProviderRateLimitError('openai', 30000);
      expect(error.message).toContain('Rate limit exceeded');
      expect(error.message).toContain('30000');
      expect(error.retryAfter).toBe(30000);
      expect(error.statusCode).toBe(429);
    });

    it('should work without retry info', () => {
      const error = new ProviderRateLimitError('openai');
      expect(error.message).toContain('Rate limit exceeded');
      expect(error.retryAfter).toBeUndefined();
    });
  });

  describe('ContextOverflowError', () => {
    it('should include budget details and provide helper methods', () => {
      const budget = {
        actualTokens: 200000,
        maxTokens: 128000,
        overageTokens: 72000,
        breakdown: {
          conversation: 100000,
          tools: 50000,
          system: 30000,
          memory: 20000,
        },
        degradationLog: ['Compacted conversation', 'Removed tool pairs', 'Still over limit'],
      };

      const error = new ContextOverflowError('Cannot fit', budget);

      expect(error.message).toContain('200000');
      expect(error.message).toContain('128000');
      expect(error.budget).toBe(budget);

      // getDegradationSummary
      const summary = error.getDegradationSummary();
      expect(summary).toContain('Compacted conversation');
      expect(summary).toContain('Still over limit');

      // getTopConsumers
      const top = error.getTopConsumers(2);
      expect(top).toHaveLength(2);
      expect(top[0]!.component).toBe('conversation');
      expect(top[0]!.tokens).toBe(100000);
      expect(top[1]!.component).toBe('tools');
      expect(top[1]!.tokens).toBe(50000);
    });
  });

  describe('Error messages include relevant details', () => {
    it('ProviderContextLengthError includes max and requested tokens', () => {
      const error = new ProviderContextLengthError('openai', 128000, 200000);
      expect(error.message).toContain('128000');
      expect(error.message).toContain('200000');
      expect(error.maxTokens).toBe(128000);
      expect(error.requestedTokens).toBe(200000);
    });

    it('ToolNotFoundError includes tool name', () => {
      const error = new ToolNotFoundError('missing_tool');
      expect(error.message).toContain('missing_tool');
      expect(error.code).toBe('TOOL_NOT_FOUND');
    });

    it('InvalidToolArgumentsError includes tool name and raw arguments', () => {
      const parseErr = new SyntaxError('Unexpected token');
      const error = new InvalidToolArgumentsError('my_tool', '{broken json', parseErr);
      expect(error.message).toContain('my_tool');
      expect(error.rawArguments).toBe('{broken json');
      expect(error.parseError).toBe(parseErr);
    });

    it('TaskTimeoutError includes task details', () => {
      const error = new TaskTimeoutError('task-42', 'Analyze data', 60000);
      expect(error.message).toContain('task-42');
      expect(error.message).toContain('Analyze data');
      expect(error.message).toContain('60000');
      expect(error.taskId).toBe('task-42');
      expect(error.timeoutMs).toBe(60000);
    });

    it('ParallelTasksError provides helper methods', () => {
      const failures = [
        { taskId: 't1', taskName: 'task1', error: new Error('err1') },
        { taskId: 't2', taskName: 'task2', error: new Error('err2') },
      ];
      const error = new ParallelTasksError(failures);

      expect(error.getFailedTaskIds()).toEqual(['t1', 't2']);
      expect(error.getErrors()).toHaveLength(2);
      expect(error.getErrors()[0]!.message).toBe('err1');
    });
  });
});
