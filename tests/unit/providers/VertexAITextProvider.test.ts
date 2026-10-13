/**
 * VertexAITextProvider Unit Tests
 * Tests the Vertex AI provider implementation with mocked SDK
 *
 * CRITICAL: Tests the generationConfig spreading fix and config inheritance
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InvalidConfigError } from '@/domain/errors/AIErrors.js';
import { StreamEventType } from '@/domain/entities/StreamEvent.js';

// Create mock functions with vi.hoisted for proper hoisting
const { mockGenerateContent, mockGenerateContentStream, mockGoogleGenAI } = vi.hoisted(() => {
  const mockGenerateContent = vi.fn();
  const mockGenerateContentStream = vi.fn();
  const mockGoogleGenAI = vi.fn(() => ({
    models: {
      generateContent: mockGenerateContent,
      generateContentStream: mockGenerateContentStream,
    },
  }));
  return { mockGenerateContent, mockGenerateContentStream, mockGoogleGenAI };
});

// Mock Google GenAI SDK
vi.mock('@google/genai', () => ({
  GoogleGenAI: mockGoogleGenAI,
}));

// Import after mocking
import { VertexAITextProvider } from '@/infrastructure/providers/vertex/VertexAITextProvider.js';

describe('VertexAITextProvider', () => {
  // Store original env vars
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env vars
    delete process.env.GOOGLE_GENAI_USE_VERTEXAI;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
  });

  afterEach(() => {
    // Restore env vars
    process.env = { ...originalEnv };
  });

  describe('constructor', () => {
    it('should throw InvalidConfigError if projectId missing', () => {
      expect(() => {
        new VertexAITextProvider({
          apiKey: '',
          location: 'us-central1',
        } as any);
      }).toThrow(InvalidConfigError);

      expect(() => {
        new VertexAITextProvider({
          apiKey: '',
          location: 'us-central1',
        } as any);
      }).toThrow(/projectId/i);
    });

    it('should throw InvalidConfigError if location missing', () => {
      expect(() => {
        new VertexAITextProvider({
          apiKey: '',
          projectId: 'my-project',
        } as any);
      }).toThrow(InvalidConfigError);

      expect(() => {
        new VertexAITextProvider({
          apiKey: '',
          projectId: 'my-project',
        } as any);
      }).toThrow(/location/i);
    });

    it('should set GOOGLE_GENAI_USE_VERTEXAI environment variable', () => {
      new VertexAITextProvider({
        apiKey: '',
        projectId: 'my-project',
        location: 'us-central1',
      });

      expect(process.env.GOOGLE_GENAI_USE_VERTEXAI).toBe('True');
    });

    it('should set GOOGLE_CLOUD_PROJECT environment variable', () => {
      new VertexAITextProvider({
        apiKey: '',
        projectId: 'my-test-project',
        location: 'us-central1',
      });

      expect(process.env.GOOGLE_CLOUD_PROJECT).toBe('my-test-project');
    });

    it('should set GOOGLE_CLOUD_LOCATION environment variable', () => {
      new VertexAITextProvider({
        apiKey: '',
        projectId: 'my-project',
        location: 'europe-west1',
      });

      expect(process.env.GOOGLE_CLOUD_LOCATION).toBe('europe-west1');
    });

    it('should create GoogleGenAI client without API key (uses ADC)', () => {
      new VertexAITextProvider({
        apiKey: '',
        projectId: 'my-project',
        location: 'us-central1',
      });

      expect(mockGoogleGenAI).toHaveBeenCalledWith({ httpOptions: { fetch: expect.any(Function) } });
    });
  });

  describe('name and capabilities', () => {
    let provider: VertexAITextProvider;

    beforeEach(() => {
      provider = new VertexAITextProvider({
        apiKey: '',
        projectId: 'my-project',
        location: 'us-central1',
      });
    });

    it('should have name "vertex-ai"', () => {
      expect(provider.name).toBe('vertex-ai');
    });

    it('should have correct capabilities (including video and audio)', () => {
      expect(provider.capabilities).toEqual({
        text: true,
        images: true,
        videos: true, // Vertex AI supports video
        audio: true, // Vertex AI supports audio
      });
    });
  });

  describe('generate()', () => {
    let provider: VertexAITextProvider;

    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [{ text: 'Hello from Vertex AI!' }],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    };

    beforeEach(() => {
      provider = new VertexAITextProvider({
        apiKey: '',
        projectId: 'my-project',
        location: 'us-central1',
      });
      mockGenerateContent.mockResolvedValue(mockResponse);
    });

    it('should spread generationConfig directly into config object (CRITICAL FIX)', async () => {
      await provider.generate({
        model: 'gemini-2.0-flash',
        input: 'Hello',
        temperature: 0.8,
        max_output_tokens: 2000,
      });

      // CRITICAL: generationConfig properties should be spread directly, not nested
      const call = mockGenerateContent.mock.calls[0][0];

      // Should NOT have nested generationConfig
      expect(call.config.generationConfig).toBeUndefined();

      // Should have properties spread directly
      expect(call.config.temperature).toBe(0.8);
      expect(call.config.maxOutputTokens).toBe(2000);
    });

    it('should call generateContent with correct model', async () => {
      await provider.generate({
        model: 'gemini-2.0-flash',
        input: 'Hello',
      });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-2.0-flash',
        })
      );
    });

    it('should pass systemInstruction correctly', async () => {
      await provider.generate({
        model: 'gemini-2.0-flash',
        input: 'Hello',
        instructions: 'Be very helpful',
      });

      const call = mockGenerateContent.mock.calls[0][0];
      expect(call.config.systemInstruction).toEqual({
        parts: [{ text: 'Be very helpful' }],
      });
    });

    it('should convert response to LLMResponse format', async () => {
      const response = await provider.generate({
        model: 'gemini-2.0-flash',
        input: 'Hello',
      });

      expect(response).toEqual(
        expect.objectContaining({
          object: 'response',
          status: 'completed',
          output_text: 'Hello from Vertex AI!',
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
          },
        })
      );
    });
  });

  describe('streamGenerate()', () => {
    let provider: VertexAITextProvider;

    beforeEach(() => {
      provider = new VertexAITextProvider({
        apiKey: '',
        projectId: 'my-project',
        location: 'us-central1',
      });
    });

    it('should spread generationConfig in stream config (CRITICAL FIX)', async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            candidates: [{ content: { parts: [{ text: 'Hi' }] } }],
          };
        },
      };
      mockGenerateContentStream.mockResolvedValue(mockStream);

      const events: any[] = [];
      for await (const event of provider.streamGenerate({
        model: 'gemini-2.0-flash',
        input: 'Hello',
        temperature: 0.3,
        max_output_tokens: 100,
      })) {
        events.push(event);
      }

      // CRITICAL: generationConfig properties should be spread directly
      const call = mockGenerateContentStream.mock.calls[0][0];
      expect(call.config.generationConfig).toBeUndefined();
      expect(call.config.temperature).toBe(0.3);
      expect(call.config.maxOutputTokens).toBe(100);
    });

    it('should emit correct stream events', async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            candidates: [{ content: { parts: [{ text: 'Hello' }] } }],
          };
          yield {
            candidates: [{ content: { parts: [{ text: ' from Vertex' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
          };
        },
      };
      mockGenerateContentStream.mockResolvedValue(mockStream);

      const events: any[] = [];
      for await (const event of provider.streamGenerate({
        model: 'gemini-2.0-flash',
        input: 'Hello',
      })) {
        events.push(event);
      }

      expect(events.some((e) => e.type === StreamEventType.RESPONSE_CREATED)).toBe(true);
      expect(events.some((e) => e.type === StreamEventType.OUTPUT_TEXT_DELTA)).toBe(true);
      expect(events.some((e) => e.type === StreamEventType.RESPONSE_COMPLETE)).toBe(true);
    });
  });

  describe('getModelCapabilities()', () => {
    let provider: VertexAITextProvider;

    beforeEach(() => {
      provider = new VertexAITextProvider({
        apiKey: '',
        projectId: 'my-project',
        location: 'us-central1',
      });
    });

    it('should return correct capabilities for gemini models', () => {
      const caps = provider.getModelCapabilities('gemini-2.0-flash');

      expect(caps.supportsTools).toBe(true);
      expect(caps.supportsVision).toBe(true);
      expect(caps.supportsJSON).toBe(true);
      expect(caps.maxTokens).toBe(1048576);
    });

    it('should return default capabilities for unknown models', () => {
      const caps = provider.getModelCapabilities('custom-model');

      expect(caps.supportsTools).toBe(true);
      expect(caps.supportsVision).toBe(true);
    });
  });

  describe('config inheritance (CRITICAL FIX)', () => {
    it('should properly use protected config from BaseTextProvider', () => {
      const provider = new VertexAITextProvider({
        apiKey: '',
        projectId: 'test-project',
        location: 'us-central1',
        timeout: 30000,
        maxRetries: 5,
      });

      // The provider should work without errors - this tests the config override fix
      expect(provider.name).toBe('vertex-ai');
    });
  });
});
