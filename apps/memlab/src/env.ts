/**
 * Detect vendor API keys in process.env and register a Connector per vendor.
 * Pick sensible defaults for chat / extract / profile / embedding models.
 */

import { Connector, Vendor, type Vendor as VendorT } from '@everworker/oneringai';

export interface VendorEntry {
  vendor: VendorT;
  connectorName: string;
  envVar: string;
  chatModel: string;
  extractModel: string;
  profileModel: string;
  /** OpenAI-style embedding model name if this vendor supports embeddings. */
  embeddingModel?: string;
  embeddingDims?: number;
}

const TABLE: Array<Omit<VendorEntry, 'connectorName'>> = [
  {
    vendor: Vendor.OpenAI,
    envVar: 'OPENAI_API_KEY',
    chatModel: 'gpt-5-mini',
    extractModel: 'gpt-5-mini',
    profileModel: 'gpt-5-mini',
    embeddingModel: 'text-embedding-3-small',
    embeddingDims: 1536,
  },
  {
    vendor: Vendor.Anthropic,
    envVar: 'ANTHROPIC_API_KEY',
    chatModel: 'claude-sonnet-4-6',
    extractModel: 'claude-haiku-4-5-20251001',
    profileModel: 'claude-haiku-4-5-20251001',
  },
  {
    vendor: Vendor.Google,
    envVar: 'GOOGLE_API_KEY',
    chatModel: 'gemini-2.5-flash',
    extractModel: 'gemini-2.5-flash',
    profileModel: 'gemini-2.5-flash',
  },
  {
    vendor: Vendor.Groq,
    envVar: 'GROQ_API_KEY',
    chatModel: 'llama-3.3-70b-versatile',
    extractModel: 'llama-3.3-70b-versatile',
    profileModel: 'llama-3.3-70b-versatile',
  },
  {
    vendor: Vendor.DeepSeek,
    envVar: 'DEEPSEEK_API_KEY',
    chatModel: 'deepseek-chat',
    extractModel: 'deepseek-chat',
    profileModel: 'deepseek-chat',
  },
  {
    vendor: Vendor.Mistral,
    envVar: 'MISTRAL_API_KEY',
    chatModel: 'mistral-large-latest',
    extractModel: 'mistral-small-latest',
    profileModel: 'mistral-small-latest',
  },
  {
    vendor: Vendor.Together,
    envVar: 'TOGETHER_API_KEY',
    chatModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    extractModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    profileModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  },
  {
    vendor: Vendor.Grok,
    envVar: 'XAI_API_KEY',
    chatModel: 'grok-4',
    extractModel: 'grok-4',
    profileModel: 'grok-4',
  },
  {
    vendor: Vendor.Perplexity,
    envVar: 'PERPLEXITY_API_KEY',
    chatModel: 'sonar',
    extractModel: 'sonar',
    profileModel: 'sonar',
  },
];

/**
 * Register a Connector for every vendor with a populated API key. Returns the
 * list in discovery order. If `MEMLAB_PRIMARY` names a registered entry, it is
 * moved to index 0 so callers can treat [0] as the primary.
 */
export function detectAndRegister(): VendorEntry[] {
  const registered: VendorEntry[] = [];
  for (const row of TABLE) {
    const key = process.env[row.envVar]?.trim();
    if (!key) continue;
    const connectorName = row.vendor;
    if (!Connector.has(connectorName)) {
      Connector.create({
        name: connectorName,
        vendor: row.vendor,
        auth: { type: 'api_key', apiKey: key },
      });
    }
    registered.push({ ...row, connectorName });
  }

  const primaryPref = process.env.MEMLAB_PRIMARY?.trim();
  if (primaryPref) {
    const i = registered.findIndex((e) => e.connectorName === primaryPref);
    if (i > 0) {
      const [moved] = registered.splice(i, 1);
      registered.unshift(moved!);
    }
  }
  return registered;
}
