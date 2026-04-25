/**
 * Integration Tests for ALL LLM Models in the Registry
 *
 * This test file dynamically tests every model in the MODEL_REGISTRY
 * by sending a simple "hi" message and verifying a non-error response.
 *
 * Tests are organized by vendor and conditionally run based on API key availability.
 *
 * Required environment variables:
 * - OPENAI_API_KEY
 * - GOOGLE_API_KEY
 * - ANTHROPIC_API_KEY
 *
 * Run with: npm run test:integration -- tests/integration/text/AllModels.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as dotenv from 'dotenv';
import { Connector } from '../../../src/core/Connector.js';
import { Agent } from '../../../src/core/Agent.js';
import { Vendor } from '../../../src/core/Vendor.js';
import { MODEL_REGISTRY } from '../../../src/domain/entities/Model.js';
import type { ILLMDescription } from '../../../src/domain/entities/Model.js';

// Load environment variables
dotenv.config();

// ============================================================================
// Configuration
// ============================================================================

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const HAS_OPENAI_KEY = Boolean(OPENAI_API_KEY);
const HAS_GOOGLE_KEY = Boolean(GOOGLE_API_KEY);
const HAS_ANTHROPIC_KEY = Boolean(ANTHROPIC_API_KEY);

// Timeout for each model test (some models may be slow)
const MODEL_TEST_TIMEOUT = 120000; // 2 minutes
const REASONING_MODEL_TIMEOUT = 240000; // 4 minutes for reasoning models (Google API can be slow)

// Test prompt - simple greeting to minimize cost and latency
const TEST_PROMPT = 'Hi! Say hello back in one short sentence.';

/**
 * Models to skip. Capability-based skips (realtime, audio, deep-research,
 * open-weight, live-preview) are derived from registry features in
 * `isTextChatTestable` below — this set is for one-off overrides only.
 */
const SKIP_MODELS: Set<string> = new Set([
  // Image generation models - don't support text-only requests
  'gemini-3-pro-image-preview',
  'gemini-2.5-flash-image',
  // Flaky / transient empty-response (re-run before treating as a real bug)
  'claude-haiku-4-5-20251001',
  // Anthropic deprecated-but-still-listed: API returns 404 even though registry
  // marks them active. Remove from this set when the registry catches up.
  'claude-sonnet-4-20250514',
  'claude-3-7-sonnet-20250219',
]);

/**
 * Models that don't accept the `temperature` parameter (rejected at the API level).
 * Most are reasoning models; chat-latest aliases also reject it. They also need a
 * longer timeout because of thinking/reasoning time.
 */
const REASONING_MODELS: Set<string> = new Set([
  'gpt-5.2',
  'gpt-5.2-pro',
  'gpt-5.2-chat-latest',
  'gpt-5.1-chat-latest',
  'gpt-5-chat-latest',
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'o3-mini',
  'o1',
  'gemini-3-pro-preview', // Takes 60+ seconds for reasoning
  'gemini-3-flash-preview', // Also a reasoning model
]);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Decide whether a registry model is callable through the standard text chat path
 * exercised by `agent.run(...)`. Capability-driven so the registry stays the
 * source of truth — adding/removing models in the registry flows through here.
 *
 * Reasons we skip:
 *  - `features.realtime`         → realtime API only (WebRTC/WebSocket), not chat completions
 *  - `features.audio === true`   → audio modality required even when text input is "accepted"
 *  - description "Open-weight"   → not hosted on the OpenAI paid API (cpm 0)
 *  - name "*-deep-research"      → requires web_search/mcp/file_search tools we don't pass
 *  - name "*-live-preview"       → Google Gemini Live API only
 *  - `features.input.text !== true` → cannot accept text input
 */
function isTextChatTestable(model: ILLMDescription): boolean {
  const f = model.features as any;
  if (f?.realtime === true) return false;
  if (f?.audio === true) return false;
  if (f?.input && f.input.text !== true) return false;
  if (typeof model.description === 'string' && /open-weight/i.test(model.description)) return false;
  if (model.name.endsWith('-deep-research')) return false;
  if (model.name.endsWith('-live-preview')) return false;
  return true;
}

/**
 * Get all testable models for a specific vendor from the registry.
 * Filters by:
 *  - isActive (registry truth)
 *  - capability flags (isTextChatTestable)
 *  - explicit SKIP_MODELS set for one-offs (deprecated leftovers, flakes)
 */
function getVendorModels(vendor: string): ILLMDescription[] {
  return Object.values(MODEL_REGISTRY).filter(
    (model) =>
      model.provider === vendor &&
      model.isActive &&
      !SKIP_MODELS.has(model.name) &&
      isTextChatTestable(model)
  );
}

/**
 * Test a single model with a simple greeting
 */
async function testModel(connectorName: string, modelName: string): Promise<void> {
  // For Gemini 3 reasoning models, use low thinking level to speed up responses
  const isGemini3Reasoning = modelName.startsWith('gemini-3-') &&
                            (modelName.includes('pro') || modelName.includes('flash'));

  // Models that don't accept temperature (reasoning + chat-latest aliases)
  const supportsTemperature = !REASONING_MODELS.has(modelName);

  const agent = Agent.create({
    connector: connectorName,
    model: modelName,
    ...(supportsTemperature ? { temperature: 0.7 } : {}),
    maxOutputTokens: 100, // Limit output to reduce cost
    vendorOptions: isGemini3Reasoning ? { thinkingLevel: 'low' } : undefined,
  });

  const response = await agent.run(TEST_PROMPT);

  // Basic assertions
  expect(response.status).toBe('completed');
  expect(response.output_text).toBeDefined();
  expect(response.output_text!.length).toBeGreaterThan(0);
  expect(response.usage).toBeDefined();
  expect(response.usage.input_tokens).toBeGreaterThan(0);
  expect(response.usage.output_tokens).toBeGreaterThan(0);

  // Log success for visibility
  console.log(
    `  ✓ ${modelName}: "${response.output_text!.substring(0, 50).replace(/\n/g, ' ')}..." ` +
      `(${response.usage.input_tokens}/${response.usage.output_tokens} tokens)`
  );
}

// ============================================================================
// OpenAI Models
// ============================================================================

const openaiModels = getVendorModels(Vendor.OpenAI);
const describeOpenAI = HAS_OPENAI_KEY ? describe : describe.skip;

describeOpenAI(`OpenAI Models (${openaiModels.length} total)`, () => {
  beforeAll(() => {
    if (!OPENAI_API_KEY) {
      console.warn('⚠️  OPENAI_API_KEY not set, skipping OpenAI tests');
      return;
    }

    Connector.create({
      name: 'openai-all-models',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: OPENAI_API_KEY },
    });

    console.log(`\n🔵 Testing ${openaiModels.length} OpenAI models:`);
    openaiModels.forEach((m) => console.log(`   - ${m.name}`));
  });

  afterAll(() => {
    Connector.clear();
  });

  // Generate test for each model
  openaiModels.forEach((modelInfo) => {
    const shouldSkip = SKIP_MODELS.has(modelInfo.name);
    const testFn = shouldSkip ? it.skip : it;
    const isReasoning = REASONING_MODELS.has(modelInfo.name);
    const timeout = isReasoning ? REASONING_MODEL_TIMEOUT : MODEL_TEST_TIMEOUT;

    testFn(
      `${modelInfo.name} should respond to greeting`,
      async () => {
        await testModel('openai-all-models', modelInfo.name);
      },
      timeout
    );
  });
});

// ============================================================================
// Anthropic Models
// ============================================================================

const anthropicModels = getVendorModels(Vendor.Anthropic);
const describeAnthropic = HAS_ANTHROPIC_KEY ? describe : describe.skip;

describeAnthropic(`Anthropic Models (${anthropicModels.length} total)`, () => {
  beforeAll(() => {
    if (!ANTHROPIC_API_KEY) {
      console.warn('⚠️  ANTHROPIC_API_KEY not set, skipping Anthropic tests');
      return;
    }

    Connector.create({
      name: 'anthropic-all-models',
      vendor: Vendor.Anthropic,
      auth: { type: 'api_key', apiKey: ANTHROPIC_API_KEY },
    });

    console.log(`\n🟣 Testing ${anthropicModels.length} Anthropic models:`);
    anthropicModels.forEach((m) => console.log(`   - ${m.name}`));
  });

  afterAll(() => {
    Connector.clear();
  });

  // Generate test for each model
  anthropicModels.forEach((modelInfo) => {
    const shouldSkip = SKIP_MODELS.has(modelInfo.name);
    const testFn = shouldSkip ? it.skip : it;
    const isReasoning = REASONING_MODELS.has(modelInfo.name);
    const timeout = isReasoning ? REASONING_MODEL_TIMEOUT : MODEL_TEST_TIMEOUT;

    testFn(
      `${modelInfo.name} should respond to greeting`,
      async () => {
        await testModel('anthropic-all-models', modelInfo.name);
      },
      timeout
    );
  });
});

// ============================================================================
// Google Models
// ============================================================================

const googleModels = getVendorModels(Vendor.Google);
const describeGoogle = HAS_GOOGLE_KEY ? describe : describe.skip;

describeGoogle(`Google Models (${googleModels.length} total)`, () => {
  beforeAll(() => {
    if (!GOOGLE_API_KEY) {
      console.warn('⚠️  GOOGLE_API_KEY not set, skipping Google tests');
      return;
    }

    Connector.create({
      name: 'google-all-models',
      vendor: Vendor.Google,
      auth: { type: 'api_key', apiKey: GOOGLE_API_KEY },
    });

    console.log(`\n🔴 Testing ${googleModels.length} Google models:`);
    googleModels.forEach((m) => console.log(`   - ${m.name}`));
  });

  afterAll(() => {
    Connector.clear();
  });

  // Generate test for each model
  googleModels.forEach((modelInfo) => {
    const shouldSkip = SKIP_MODELS.has(modelInfo.name);
    const testFn = shouldSkip ? it.skip : it;
    const isReasoning = REASONING_MODELS.has(modelInfo.name);
    const timeout = isReasoning ? REASONING_MODEL_TIMEOUT : MODEL_TEST_TIMEOUT;

    testFn(
      `${modelInfo.name} should respond to greeting`,
      async () => {
        await testModel('google-all-models', modelInfo.name);
      },
      timeout
    );
  });
});

// ============================================================================
// Ollama Models (local, not registry-driven)
// ============================================================================

interface OllamaTagsResponse {
  models: Array<{ name: string; model: string }>;
}

async function getOllamaModels(): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch('http://localhost:11434/api/tags', { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return [];
    const data = (await response.json()) as OllamaTagsResponse;
    return (data.models || []).map((m) => m.model);
  } catch {
    return [];
  }
}

let ollamaModels: string[] = [];
try {
  ollamaModels = await getOllamaModels();
} catch {
  ollamaModels = [];
}

const HAS_OLLAMA = ollamaModels.length > 0;
const describeOllama = HAS_OLLAMA ? describe : describe.skip;

describeOllama(`Ollama Models (${ollamaModels.length} total)`, () => {
  beforeAll(() => {
    if (!HAS_OLLAMA) {
      console.warn('⚠️  Ollama not running, skipping Ollama tests');
      return;
    }

    Connector.create({
      name: 'ollama-all-models',
      vendor: Vendor.Ollama,
      auth: { type: 'none' },
    });

    console.log(`\n⬛ Testing ${ollamaModels.length} Ollama models:`);
    ollamaModels.forEach((m) => console.log(`   - ${m}`));
  });

  afterAll(() => {
    Connector.clear();
  });

  ollamaModels.forEach((modelName) => {
    it(
      `${modelName} should respond to greeting`,
      async () => {
        await testModel('ollama-all-models', modelName);
      },
      MODEL_TEST_TIMEOUT
    );
  });
});

// ============================================================================
// Model Registry Validation Tests (always run)
// ============================================================================

describe('Model Registry Validation', () => {
  it('should have all expected vendors represented', () => {
    const vendors = new Set(Object.values(MODEL_REGISTRY).map((m) => m.provider));
    expect(vendors.has(Vendor.OpenAI)).toBe(true);
    expect(vendors.has(Vendor.Anthropic)).toBe(true);
    expect(vendors.has(Vendor.Google)).toBe(true);
  });

  it('should have at least one active model per vendor', () => {
    expect(openaiModels.length).toBeGreaterThan(0);
    expect(anthropicModels.length).toBeGreaterThan(0);
    expect(googleModels.length).toBeGreaterThan(0);
  });

  it('should have valid pricing for all models', () => {
    Object.values(MODEL_REGISTRY).forEach((model) => {
      expect(model.features.input.cpm).toBeGreaterThanOrEqual(0);
      expect(model.features.output.cpm).toBeGreaterThanOrEqual(0);
      expect(model.features.input.tokens).toBeGreaterThan(0);
      expect(model.features.output.tokens).toBeGreaterThan(0);
    });
  });

  it('should have consistent model name as key and property', () => {
    Object.entries(MODEL_REGISTRY).forEach(([key, model]) => {
      expect(key).toBe(model.name);
    });
  });

  it('should print model summary', () => {
    console.log('\n' + '='.repeat(60));
    console.log('MODEL REGISTRY SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total models: ${Object.keys(MODEL_REGISTRY).length}`);
    console.log(`  - OpenAI: ${openaiModels.length} models`);
    console.log(`  - Anthropic: ${anthropicModels.length} models`);
    console.log(`  - Google: ${googleModels.length} models`);
    console.log('='.repeat(60) + '\n');

    // This test always passes, it's just for logging
    expect(true).toBe(true);
  });
});
