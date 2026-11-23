/**
 * Supported AI Vendors
 *
 * Use this enum instead of string literals for type safety.
 * These map to specific provider implementations.
 */
export const Vendor = {
  OpenAI: 'openai',
  Anthropic: 'anthropic',
  Google: 'google',
  GoogleVertex: 'google-vertex',
  Groq: 'groq',
  Together: 'together',
  Perplexity: 'perplexity',
  Grok: 'grok',
  DeepSeek: 'deepseek',
  Mistral: 'mistral',
  Ollama: 'ollama',
  OMLX: 'omlx',
  Custom: 'custom', // OpenAI-compatible endpoint
} as const;

export type Vendor = (typeof Vendor)[keyof typeof Vendor];

/**
 * All vendor values as array (useful for validation)
 */
export const VENDORS = Object.values(Vendor);

/**
 * Check if a string is a valid vendor
 */
export function isVendor(value: string): value is Vendor {
  return VENDORS.includes(value as Vendor);
}
