/**
 * Vendor Unit Tests
 * Tests the Vendor enum, VENDORS array, and isVendor type guard
 */

import { describe, it, expect } from 'vitest';
import { Vendor, VENDORS, isVendor } from '@/core/Vendor.js';

describe('Vendor', () => {
  describe('enum values', () => {
    it('has OpenAI vendor with correct value', () => {
      expect(Vendor.OpenAI).toBe('openai');
    });

    it('has Anthropic vendor with correct value', () => {
      expect(Vendor.Anthropic).toBe('anthropic');
    });

    it('has Google vendor with correct value', () => {
      expect(Vendor.Google).toBe('google');
    });

    it('has GoogleVertex vendor with correct value', () => {
      expect(Vendor.GoogleVertex).toBe('google-vertex');
    });

    it('has Groq vendor with correct value', () => {
      expect(Vendor.Groq).toBe('groq');
    });

    it('has Together vendor with correct value', () => {
      expect(Vendor.Together).toBe('together');
    });

    it('has Perplexity vendor with correct value', () => {
      expect(Vendor.Perplexity).toBe('perplexity');
    });

    it('has Grok vendor with correct value', () => {
      expect(Vendor.Grok).toBe('grok');
    });

    it('has DeepSeek vendor with correct value', () => {
      expect(Vendor.DeepSeek).toBe('deepseek');
    });

    it('has Mistral vendor with correct value', () => {
      expect(Vendor.Mistral).toBe('mistral');
    });

    it('has Ollama vendor with correct value', () => {
      expect(Vendor.Ollama).toBe('ollama');
    });

    it('has Custom vendor with correct value', () => {
      expect(Vendor.Custom).toBe('custom');
    });
  });

  describe('VENDORS array', () => {
    it('contains openai', () => {
      expect(VENDORS).toContain('openai');
    });

    it('contains anthropic', () => {
      expect(VENDORS).toContain('anthropic');
    });

    it('contains google', () => {
      expect(VENDORS).toContain('google');
    });

    it('contains google-vertex', () => {
      expect(VENDORS).toContain('google-vertex');
    });

    it('contains all vendor values', () => {
      const expectedVendors = [
        'openai',
        'anthropic',
        'google',
        'google-vertex',
        'groq',
        'together',
        'perplexity',
        'grok',
        'deepseek',
        'mistral',
        'ollama',
        'omlx',
        'custom',
      ];
      for (const vendor of expectedVendors) {
        expect(VENDORS).toContain(vendor);
      }
      expect(VENDORS).toHaveLength(expectedVendors.length);
    });
  });

  describe('isVendor()', () => {
    it('returns true for valid vendor string "openai"', () => {
      expect(isVendor('openai')).toBe(true);
    });

    it('returns true for valid vendor string "anthropic"', () => {
      expect(isVendor('anthropic')).toBe(true);
    });

    it('returns true for valid vendor string "google"', () => {
      expect(isVendor('google')).toBe(true);
    });

    it('returns true for valid vendor string "google-vertex"', () => {
      expect(isVendor('google-vertex')).toBe(true);
    });

    it('returns true for all valid vendors', () => {
      for (const vendor of VENDORS) {
        expect(isVendor(vendor)).toBe(true);
      }
    });

    it('returns false for invalid vendor string', () => {
      expect(isVendor('invalid-vendor')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isVendor('')).toBe(false);
    });

    it('returns false for similar but incorrect strings', () => {
      expect(isVendor('OpenAI')).toBe(false); // Case sensitive
      expect(isVendor('OPENAI')).toBe(false);
      expect(isVendor('open-ai')).toBe(false);
      expect(isVendor('open_ai')).toBe(false);
    });

    it('returns false for partial matches', () => {
      expect(isVendor('open')).toBe(false);
      expect(isVendor('goo')).toBe(false);
    });
  });
});
