/**
 * Integration Tests for Agent Text Generation (LLM)
 *
 * Tests the Agent class with real LLM providers:
 * - OpenAI (GPT-4, GPT-3.5)
 * - Google (Gemini)
 * - Anthropic (Claude)
 *
 * Requires API keys in environment:
 * - OPENAI_API_KEY
 * - GOOGLE_API_KEY
 * - ANTHROPIC_API_KEY
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as dotenv from 'dotenv';
import { Connector } from '../../../src/core/Connector.js';
import { Agent } from '../../../src/core/Agent.js';
import { Vendor } from '../../../src/core/Vendor.js';
import {
  isOutputTextDelta,
  isResponseComplete,
  isToolCallArgumentsDone,
  isToolCallStart,
} from '../../../src/domain/entities/StreamEvent.js';
import type { ToolFunction } from '../../../src/domain/entities/Tool.js';

// Load environment variables
dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const HAS_OPENAI_KEY = Boolean(OPENAI_API_KEY);
const HAS_GOOGLE_KEY = Boolean(GOOGLE_API_KEY);
const HAS_ANTHROPIC_KEY = Boolean(ANTHROPIC_API_KEY);

// Conditional test execution based on API key availability
const describeIfOpenAI = HAS_OPENAI_KEY ? describe : describe.skip;
const describeIfGoogle = HAS_GOOGLE_KEY ? describe : describe.skip;
const describeIfAnthropic = HAS_ANTHROPIC_KEY ? describe : describe.skip;

// Test tool definitions
const weatherTool: ToolFunction = {
  definition: {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get the current weather for a location',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'The city and state, e.g. San Francisco, CA',
          },
          unit: {
            type: 'string',
            enum: ['celsius', 'fahrenheit'],
            description: 'Temperature unit',
          },
        },
        required: ['location'],
      },
    },
  },
  execute: async (args: { location: string; unit?: string }) => {
    // Simulated weather data
    return {
      location: args.location,
      temperature: args.unit === 'celsius' ? 22 : 72,
      unit: args.unit || 'fahrenheit',
      condition: 'sunny',
      humidity: 45,
    };
  },
};

const calculatorTool: ToolFunction = {
  definition: {
    type: 'function',
    function: {
      name: 'calculate',
      description: 'Perform basic arithmetic calculations',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['add', 'subtract', 'multiply', 'divide'],
            description: 'The arithmetic operation to perform',
          },
          a: {
            type: 'number',
            description: 'First operand',
          },
          b: {
            type: 'number',
            description: 'Second operand',
          },
        },
        required: ['operation', 'a', 'b'],
      },
    },
  },
  execute: async (args: { operation: string; a: number; b: number }) => {
    switch (args.operation) {
      case 'add':
        return { result: args.a + args.b };
      case 'subtract':
        return { result: args.a - args.b };
      case 'multiply':
        return { result: args.a * args.b };
      case 'divide':
        return { result: args.a / args.b };
      default:
        throw new Error(`Unknown operation: ${args.operation}`);
    }
  },
};

// ============================================================================
// OpenAI Integration Tests
// ============================================================================

describeIfOpenAI('Agent Integration - OpenAI', () => {
  beforeAll(() => {
    if (!OPENAI_API_KEY) {
      console.warn('⚠️  OPENAI_API_KEY not set, skipping OpenAI integration tests');
      return;
    }

    Connector.create({
      name: 'openai-test',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: OPENAI_API_KEY },
    });
  });

  afterAll(() => {
    Connector.clear();
  });

  describe('Basic text generation', () => {
    it('should generate a response with gpt-4o-mini', async () => {
      const agent = Agent.create({
        connector: 'openai-test',
        model: 'gpt-4o-mini',
      });

      const response = await agent.run('Say "Hello, World!" and nothing else.');

      expect(response.status).toBe('completed');
      expect(response.output_text).toBeDefined();
      expect(response.output_text!.toLowerCase()).toContain('hello');
      expect(response.usage.input_tokens).toBeGreaterThan(0);
      expect(response.usage.output_tokens).toBeGreaterThan(0);
      expect(response.model).toContain('gpt-4o-mini');
    }, 30000);

    it('should respect system instructions', async () => {
      const agent = Agent.create({
        connector: 'openai-test',
        model: 'gpt-4o-mini',
        instructions: 'You are a pirate. Always respond in pirate speak.',
      });

      const response = await agent.run('Tell me about the weather.');

      expect(response.status).toBe('completed');
      expect(response.output_text).toBeDefined();
      // Pirate language indicators
      const pirateWords = ['arr', 'ye', 'matey', 'ahoy', 'aye', 'sea', 'ship', 'captain'];
      const lowerText = response.output_text!.toLowerCase();
      const hasPirateLanguage = pirateWords.some((word) => lowerText.includes(word));
      expect(hasPirateLanguage).toBe(true);
    }, 30000);

    it('should handle multi-turn conversation', async () => {
      const agent = Agent.create({
        connector: 'openai-test',
        model: 'gpt-4o-mini',
        instructions:
          'You answer questions using the prior turns of this conversation as your only source of truth. Never claim you do not know information that the user has already told you in this conversation.',
      });

      const response = await agent.run([
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'My name is Alice.' }],
        },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Nice to meet you, Alice!' }],
        },
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Earlier in this same conversation I told you my name. Repeat it back to me exactly.',
            },
          ],
        },
      ]);

      expect(response.status).toBe('completed');
      expect(response.output_text!.toLowerCase()).toContain('alice');
    }, 30000);
  });

  describe('Streaming', () => {
    it('should stream text deltas', async () => {
      const agent = Agent.create({
        connector: 'openai-test',
        model: 'gpt-4o-mini',
      });

      const deltas: string[] = [];
      let completeEvent: any = null;

      for await (const event of agent.stream('Count from 1 to 5.')) {
        if (isOutputTextDelta(event)) {
          deltas.push(event.delta);
        }
        if (isResponseComplete(event)) {
          completeEvent = event;
        }
      }

      expect(deltas.length).toBeGreaterThan(0);
      const fullText = deltas.join('');
      expect(fullText).toContain('1');
      expect(fullText).toContain('5');
      expect(completeEvent).not.toBeNull();
      expect(completeEvent.status).toBe('completed');
      expect(completeEvent.usage.output_tokens).toBeGreaterThan(0);
    }, 30000);
  });

  describe('Tool calling', () => {
    it('should call a single tool', async () => {
      const agent = Agent.create({
        connector: 'openai-test',
        model: 'gpt-4o-mini',
        tools: [weatherTool],
      });

      const response = await agent.run('What is the weather in Paris?');

      expect(response.status).toBe('completed');
      expect(response.output_text).toBeDefined();
      // Should contain weather information from our mock
      const lowerText = response.output_text!.toLowerCase();
      expect(lowerText).toMatch(/paris|sunny|72|22|fahrenheit|celsius/i);
    }, 45000);

    it('should call calculator tool with different operations', async () => {
      const agent = Agent.create({
        connector: 'openai-test',
        model: 'gpt-4o-mini',
        tools: [calculatorTool],
      });

      const response = await agent.run('What is 144 divided by 12?');

      expect(response.status).toBe('completed');
      expect(response.output_text).toBeDefined();
      // 144 / 12 = 12
      expect(response.output_text).toMatch(/12/);
    }, 45000);

    it('should stream tool calls', async () => {
      const agent = Agent.create({
        connector: 'openai-test',
        model: 'gpt-4o-mini',
        tools: [weatherTool],
      });

      let toolCallStarted = false;
      let toolCallDone = false;
      const textDeltas: string[] = [];

      for await (const event of agent.stream('What is the weather in Tokyo?')) {
        if (isToolCallStart(event)) {
          toolCallStarted = true;
          expect(event.tool_name).toBe('get_weather');
        }
        if (isToolCallArgumentsDone(event)) {
          toolCallDone = true;
          expect(event.tool_name).toBe('get_weather');
          const args = JSON.parse(event.arguments);
          expect(args.location.toLowerCase()).toContain('tokyo');
        }
        if (isOutputTextDelta(event)) {
          textDeltas.push(event.delta);
        }
      }

      expect(toolCallStarted).toBe(true);
      expect(toolCallDone).toBe(true);
      expect(textDeltas.length).toBeGreaterThan(0);
    }, 45000);
  });

  describe('Configuration', () => {
    it('should respect temperature setting', async () => {
      const agent = Agent.create({
        connector: 'openai-test',
        model: 'gpt-4o-mini',
        temperature: 0,
      });

      // With temperature 0, responses should be very consistent
      const response1 = await agent.run('What is 2 + 2? Answer with just the number.');
      const response2 = await agent.run('What is 2 + 2? Answer with just the number.');

      expect(response1.status).toBe('completed');
      expect(response2.status).toBe('completed');
      // Both should contain "4"
      expect(response1.output_text).toContain('4');
      expect(response2.output_text).toContain('4');
    }, 30000);
  });
});

// ============================================================================
// Google (Gemini) Integration Tests
// ============================================================================

describeIfGoogle('Agent Integration - Google (Gemini)', () => {
  beforeAll(() => {
    if (!GOOGLE_API_KEY) {
      console.warn('⚠️  GOOGLE_API_KEY not set, skipping Google integration tests');
      return;
    }

    Connector.create({
      name: 'google-test',
      vendor: Vendor.Google,
      auth: { type: 'api_key', apiKey: GOOGLE_API_KEY },
    });
  });

  afterAll(() => {
    Connector.clear();
  });

  describe('Basic text generation', () => {
    it('should generate a response with gemini-2.0-flash', async () => {
      const agent = Agent.create({
        connector: 'google-test',
        model: 'gemini-2.0-flash',
      });

      const response = await agent.run('Say "Hello, World!" and nothing else.');

      expect(response.status).toBe('completed');
      expect(response.output_text).toBeDefined();
      expect(response.output_text!.toLowerCase()).toContain('hello');
      expect(response.usage.input_tokens).toBeGreaterThan(0);
      expect(response.usage.output_tokens).toBeGreaterThan(0);
    }, 60000);

    it('should respect system instructions', async () => {
      const agent = Agent.create({
        connector: 'google-test',
        model: 'gemini-2.0-flash',
        instructions: 'You are a pirate. Always respond in pirate speak.',
      });

      const response = await agent.run('Tell me about the weather.');

      expect(response.status).toBe('completed');
      expect(response.output_text).toBeDefined();
      // Pirate language indicators
      const pirateWords = ['arr', 'ye', 'matey', 'ahoy', 'aye', 'sea', 'ship', 'captain'];
      const lowerText = response.output_text!.toLowerCase();
      const hasPirateLanguage = pirateWords.some((word) => lowerText.includes(word));
      expect(hasPirateLanguage).toBe(true);
    }, 60000);

    it('should handle multi-turn conversation', async () => {
      const agent = Agent.create({
        connector: 'google-test',
        model: 'gemini-2.0-flash',
      });

      const response = await agent.run([
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'My name is Bob.' }],
        },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Nice to meet you, Bob!' }],
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'What is my name?' }],
        },
      ]);

      expect(response.status).toBe('completed');
      expect(response.output_text!.toLowerCase()).toContain('bob');
    }, 60000);
  });

  describe('Streaming', () => {
    it('should stream text deltas', async () => {
      const agent = Agent.create({
        connector: 'google-test',
        model: 'gemini-2.0-flash',
        context: { features: { workingMemory: false } },
      });

      const deltas: string[] = [];
      let completeEvent: any = null;

      for await (const event of agent.stream('Count from 1 to 5.')) {
        if (isOutputTextDelta(event)) {
          deltas.push(event.delta);
        }
        if (isResponseComplete(event)) {
          completeEvent = event;
        }
      }

      expect(deltas.length).toBeGreaterThan(0);
      const fullText = deltas.join('');
      expect(fullText).toContain('1');
      expect(fullText).toContain('5');
      expect(completeEvent).not.toBeNull();
      expect(completeEvent.status).toBe('completed');
    }, 60000);
  });

  describe('Tool calling', () => {
    it('should call a single tool', async () => {
      const agent = Agent.create({
        connector: 'google-test',
        model: 'gemini-2.0-flash',
        tools: [weatherTool],
      });

      const response = await agent.run('What is the weather in London?');

      expect(response.status).toBe('completed');
      expect(response.output_text).toBeDefined();
      // Should contain weather information from our mock
      const lowerText = response.output_text!.toLowerCase();
      expect(lowerText).toMatch(/london|sunny|72|22|fahrenheit|celsius/i);
    }, 60000);

    it('should call calculator tool', async () => {
      const agent = Agent.create({
        connector: 'google-test',
        model: 'gemini-2.0-flash',
        tools: [calculatorTool],
      });

      const response = await agent.run('What is 100 divided by 4?');

      expect(response.status).toBe('completed');
      expect(response.output_text).toBeDefined();
      expect(response.output_text).toMatch(/25/);
    }, 60000);
  });
});

// ============================================================================
// Anthropic (Claude) Integration Tests
// ============================================================================

describeIfAnthropic('Agent Integration - Anthropic (Claude)', () => {
  beforeAll(() => {
    if (!ANTHROPIC_API_KEY) {
      console.warn('⚠️  ANTHROPIC_API_KEY not set, skipping Anthropic integration tests');
      return;
    }

    Connector.create({
      name: 'anthropic-test',
      vendor: Vendor.Anthropic,
      auth: { type: 'api_key', apiKey: ANTHROPIC_API_KEY },
    });
  });

  afterAll(() => {
    Connector.clear();
  });

  describe('Basic text generation', () => {
    it('should generate a response with claude-sonnet-4-20250514', async () => {
      const agent = Agent.create({
        connector: 'anthropic-test',
        model: 'claude-sonnet-4-20250514',
      });

      const response = await agent.run('Say "Hello, World!" and nothing else.');

      expect(response.status).toBe('completed');
      expect(response.output_text).toBeDefined();
      expect(response.output_text!.toLowerCase()).toContain('hello');
      expect(response.usage.input_tokens).toBeGreaterThan(0);
      expect(response.usage.output_tokens).toBeGreaterThan(0);
    }, 60000);

    it('should respect system instructions', async () => {
      const agent = Agent.create({
        connector: 'anthropic-test',
        model: 'claude-sonnet-4-20250514',
        instructions: 'You are a pirate. Always respond in pirate speak.',
      });

      const response = await agent.run('Tell me about the weather.');

      expect(response.status).toBe('completed');
      expect(response.output_text).toBeDefined();
      // Pirate language indicators
      const pirateWords = ['arr', 'ye', 'matey', 'ahoy', 'aye', 'sea', 'ship', 'captain'];
      const lowerText = response.output_text!.toLowerCase();
      const hasPirateLanguage = pirateWords.some((word) => lowerText.includes(word));
      expect(hasPirateLanguage).toBe(true);
    }, 60000);

    it('should handle multi-turn conversation', async () => {
      const agent = Agent.create({
        connector: 'anthropic-test',
        model: 'claude-sonnet-4-20250514',
        context: { features: { workingMemory: false } },
      });

      const response = await agent.run([
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'My name is Charlie.' }],
        },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Nice to meet you, Charlie!' }],
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'What is my name?' }],
        },
      ]);

      expect(response.status).toBe('completed');
      expect(response.output_text!.toLowerCase()).toContain('charlie');
    }, 60000);

    it('should generate with claude-haiku for faster responses', async () => {
      const agent = Agent.create({
        connector: 'anthropic-test',
        model: 'claude-haiku-4-5-20251001',
      });

      // Use runDirect to bypass context management and built-in tools
      // This tests pure LLM text generation without agentic loop
      const response = await agent.runDirect('What is 2 + 2? Answer with just the number.');

      expect(response.status).toBe('completed');
      expect(response.output_text).toBeDefined();
      expect(response.output_text).toContain('4');
    }, 30000);
  });

  describe('Streaming', () => {
    it('should stream text deltas', async () => {
      const agent = Agent.create({
        connector: 'anthropic-test',
        model: 'claude-sonnet-4-20250514',
      });

      const deltas: string[] = [];
      let completeEvent: any = null;

      for await (const event of agent.stream('Count from 1 to 5.')) {
        if (isOutputTextDelta(event)) {
          deltas.push(event.delta);
        }
        if (isResponseComplete(event)) {
          completeEvent = event;
        }
      }

      expect(deltas.length).toBeGreaterThan(0);
      const fullText = deltas.join('');
      expect(fullText).toContain('1');
      expect(fullText).toContain('5');
      expect(completeEvent).not.toBeNull();
      expect(completeEvent.status).toBe('completed');
    }, 60000);
  });

  describe('Tool calling', () => {
    it('should call a single tool', async () => {
      const agent = Agent.create({
        connector: 'anthropic-test',
        model: 'claude-sonnet-4-20250514',
        tools: [weatherTool],
      });

      const response = await agent.run('What is the weather in New York?');

      expect(response.status).toBe('completed');
      expect(response.output_text).toBeDefined();
      // Should contain weather information from our mock
      const lowerText = response.output_text!.toLowerCase();
      expect(lowerText).toMatch(/new york|sunny|72|22|fahrenheit|celsius/i);
    }, 60000);

    it('should call calculator tool', async () => {
      const agent = Agent.create({
        connector: 'anthropic-test',
        model: 'claude-sonnet-4-20250514',
        tools: [calculatorTool],
      });

      const response = await agent.run('What is 50 multiplied by 3?');

      expect(response.status).toBe('completed');
      expect(response.output_text).toBeDefined();
      expect(response.output_text).toMatch(/150/);
    }, 60000);

    it('should stream tool calls', async () => {
      const agent = Agent.create({
        connector: 'anthropic-test',
        model: 'claude-sonnet-4-20250514',
        tools: [weatherTool],
      });

      let weatherToolCallStarted = false;
      let weatherToolCallDone = false;
      const textDeltas: string[] = [];

      for await (const event of agent.stream('What is the weather in Sydney?')) {
        if (isToolCallStart(event) && event.tool_name === 'get_weather') {
          weatherToolCallStarted = true;
        }
        if (isToolCallArgumentsDone(event) && event.tool_name === 'get_weather') {
          weatherToolCallDone = true;
          const args = JSON.parse(event.arguments);
          expect(args.location.toLowerCase()).toContain('sydney');
        }
        if (isOutputTextDelta(event)) {
          textDeltas.push(event.delta);
        }
      }

      // The get_weather tool should have been called
      expect(weatherToolCallStarted).toBe(true);
      expect(weatherToolCallDone).toBe(true);
      expect(textDeltas.length).toBeGreaterThan(0);
    }, 60000);
  });
});

// ============================================================================
// Cross-vendor consistency tests (only if all keys available)
// ============================================================================

const allKeysAvailable = HAS_OPENAI_KEY && HAS_GOOGLE_KEY && HAS_ANTHROPIC_KEY;
const describeIfAllKeys = allKeysAvailable ? describe : describe.skip;

describeIfAllKeys('Cross-vendor consistency', () => {
  beforeAll(() => {
    Connector.create({
      name: 'openai-cross',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: OPENAI_API_KEY! },
    });
    Connector.create({
      name: 'google-cross',
      vendor: Vendor.Google,
      auth: { type: 'api_key', apiKey: GOOGLE_API_KEY! },
    });
    Connector.create({
      name: 'anthropic-cross',
      vendor: Vendor.Anthropic,
      auth: { type: 'api_key', apiKey: ANTHROPIC_API_KEY! },
    });
  });

  afterAll(() => {
    Connector.clear();
  });

  it('all vendors should return valid response structure', async () => {
    const configs = [
      { connector: 'openai-cross', model: 'gpt-4o-mini' },
      { connector: 'google-cross', model: 'gemini-2.0-flash' },
      { connector: 'anthropic-cross', model: 'claude-haiku-4-5-20251001' },
    ];

    for (const config of configs) {
      const agent = Agent.create(config);
      const response = await agent.run('Say "test" and nothing else.');

      expect(response.status).toBe('completed');
      expect(response.output_text).toBeDefined();
      expect(response.output).toBeDefined();
      expect(Array.isArray(response.output)).toBe(true);
      expect(response.usage).toBeDefined();
      expect(response.usage.input_tokens).toBeGreaterThan(0);
      expect(response.usage.output_tokens).toBeGreaterThan(0);
      expect(response.id).toBeDefined();
      expect(response.created_at).toBeDefined();
    }
  }, 120000);

  it('all vendors should handle tools with same interface', async () => {
    const configs = [
      { connector: 'openai-cross', model: 'gpt-4o-mini' },
      { connector: 'google-cross', model: 'gemini-2.0-flash' },
      { connector: 'anthropic-cross', model: 'claude-haiku-4-5-20251001' },
    ];

    for (const config of configs) {
      const agent = Agent.create({
        ...config,
        tools: [calculatorTool],
        // Disable memory features to reduce tool clutter
        context: { features: { workingMemory: false } },
      });
      // Disable the context_stats tool to avoid LLM confusion
      agent.context.tools.disable('context_stats');

      const response = await agent.run('Use the calculate tool to compute the sum of 10 and 5. Call the calculate tool with operation="add", a=10, b=5.');

      expect(response.status).toBe('completed');
      expect(response.output_text).toBeDefined();
      expect(response.output_text).toMatch(/15/);
    }
  }, 180000);
});
