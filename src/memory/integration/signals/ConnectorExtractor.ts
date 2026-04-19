/**
 * ConnectorExtractor — default `IExtractor` implementation. Wraps an oneringai
 * Connector + model into a single-shot JSON-output LLM call.
 *
 * Mirrors the pattern used by `ConnectorProfileGenerator`: construct an agent
 * with no tools / no context management, call `runDirect` with
 * `responseFormat: { type: 'json_object' }`, and defensively parse the
 * response (some providers don't strictly honor the format instruction).
 */

import { Agent } from '../../../core/Agent.js';
import type { ExtractionOutput } from '../ExtractionResolver.js';
import {
  parseExtractionResponse as parseExtractionResponseInternal,
  parseExtractionWithStatus,
} from '../parseExtraction.js';
import { logger } from '../../../infrastructure/observability/Logger.js';
import type { IExtractor } from './types.js';

export interface ConnectorExtractorConfig {
  /** Connector name — must already be registered with `Connector.create()`. */
  connector: string;
  /** Chat/LLM model id, e.g. 'claude-sonnet-4-6' or 'gpt-5-mini'. */
  model: string;
  /** Default 0.2 — tighter sampling keeps JSON well-formed. */
  temperature?: number;
  /** Default 2000 — rooms for ~20 mentions + ~50 facts. */
  maxOutputTokens?: number;
}

export class ConnectorExtractor implements IExtractor {
  private readonly agent: Agent;
  private readonly temperature: number;
  private readonly maxOutputTokens: number;

  constructor(config: ConnectorExtractorConfig) {
    this.agent = Agent.create({
      connector: config.connector,
      model: config.model,
    });
    this.temperature = config.temperature ?? 0.2;
    this.maxOutputTokens = config.maxOutputTokens ?? 2000;
  }

  /**
   * Construct from a pre-built agent-like object. Intended for testing and
   * callers with their own LLM plumbing. The object must expose `runDirect`
   * (returning `{ output_text }`) and `destroy`.
   */
  static withAgent(args: {
    agent: { runDirect: Agent['runDirect']; destroy: Agent['destroy'] };
    temperature?: number;
    maxOutputTokens?: number;
  }): ConnectorExtractor {
    const instance = Object.create(ConnectorExtractor.prototype) as ConnectorExtractor;
    const bag = instance as unknown as {
      agent: { runDirect: Agent['runDirect']; destroy: Agent['destroy'] };
      temperature: number;
      maxOutputTokens: number;
    };
    bag.agent = args.agent;
    bag.temperature = args.temperature ?? 0.2;
    bag.maxOutputTokens = args.maxOutputTokens ?? 2000;
    return instance;
  }

  async extract(prompt: string): Promise<ExtractionOutput> {
    const response = await this.agent.runDirect(prompt, {
      temperature: this.temperature,
      maxOutputTokens: this.maxOutputTokens,
      responseFormat: { type: 'json_object' },
    });
    const raw = response.output_text ?? '';
    const parsed = parseExtractionWithStatus(raw);
    if (parsed.status !== 'ok') {
      // No silent errors (CLAUDE.md). Parser failed — surface with enough
      // context to debug. The ingest pipeline continues with the partial
      // result (`parsed.mentions`/`parsed.facts` may still contain the
      // fields that did parse), matching pre-existing tolerant behaviour.
      logger.warn(
        {
          component: 'ConnectorExtractor',
          status: parsed.status,
          reason: parsed.reason,
          rawExcerpt: parsed.rawExcerpt,
        },
        'LLM extraction parse failed',
      );
    }
    return { mentions: parsed.mentions, facts: parsed.facts };
  }

  destroy(): void {
    this.agent.destroy();
  }
}

/** Re-exported for backward-compatibility — actual impl lives in parseExtraction.ts. */
export const parseExtractionResponse = parseExtractionResponseInternal;
