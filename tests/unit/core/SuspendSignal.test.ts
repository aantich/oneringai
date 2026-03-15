import { describe, it, expect } from 'vitest';
import { SuspendSignal } from '../../../src/core/SuspendSignal.js';

describe('SuspendSignal', () => {
  describe('create()', () => {
    it('should create a SuspendSignal with required fields', () => {
      const signal = SuspendSignal.create({
        result: 'Email sent',
        correlationId: 'email:msg_123',
      });

      expect(signal.result).toBe('Email sent');
      expect(signal.correlationId).toBe('email:msg_123');
      expect(signal.resumeAs).toBe('user_message');
      expect(signal.ttl).toBe(7 * 24 * 60 * 60 * 1000);
      expect(signal.metadata).toBeUndefined();
    });

    it('should accept all optional fields', () => {
      const signal = SuspendSignal.create({
        result: { status: 'sent', id: 42 },
        correlationId: 'ticket:T-456',
        resumeAs: 'tool_result',
        ttl: 3600000,
        metadata: { ticketId: 'T-456', priority: 'high' },
      });

      expect(signal.result).toEqual({ status: 'sent', id: 42 });
      expect(signal.correlationId).toBe('ticket:T-456');
      expect(signal.resumeAs).toBe('tool_result');
      expect(signal.ttl).toBe(3600000);
      expect(signal.metadata).toEqual({ ticketId: 'T-456', priority: 'high' });
    });

    it('should throw if correlationId is empty', () => {
      expect(() => SuspendSignal.create({
        result: 'test',
        correlationId: '',
      })).toThrow('SuspendSignal requires a correlationId');
    });
  });

  describe('is()', () => {
    it('should return true for SuspendSignal instances', () => {
      const signal = SuspendSignal.create({
        result: 'test',
        correlationId: 'test:1',
      });

      expect(SuspendSignal.is(signal)).toBe(true);
    });

    it('should return false for plain objects', () => {
      expect(SuspendSignal.is({ result: 'test', correlationId: 'test:1' })).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(SuspendSignal.is(null)).toBe(false);
      expect(SuspendSignal.is(undefined)).toBe(false);
    });

    it('should return false for primitives', () => {
      expect(SuspendSignal.is('string')).toBe(false);
      expect(SuspendSignal.is(42)).toBe(false);
      expect(SuspendSignal.is(true)).toBe(false);
    });
  });

  describe('defaults', () => {
    it('should default resumeAs to user_message', () => {
      const signal = SuspendSignal.create({
        result: 'test',
        correlationId: 'test:1',
      });
      expect(signal.resumeAs).toBe('user_message');
    });

    it('should default ttl to 7 days', () => {
      const signal = SuspendSignal.create({
        result: 'test',
        correlationId: 'test:1',
      });
      expect(signal.ttl).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });
});
