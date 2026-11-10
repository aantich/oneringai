/**
 * Provider configuration types
 */

/**
 * Authentication configuration for API key auth
 */
export interface APIKeyAuth {
  type: 'api_key';
  apiKey: string;
}

/** Runtime-only OpenAI API key provider. */
export interface APIKeyProviderAuth {
  type: 'api_key_provider';
  getApiKey: () => Promise<string>;
}

export interface BaseProviderConfig {
  apiKey: string;
  baseURL?: string;
  organization?: string;
  timeout?: number; // Request timeout in ms
  maxRetries?: number; // Max retry attempts
}

/**
 * Extended OpenAI config for media providers (TTS, STT, Image)
 * Supports both legacy apiKey and new auth structure
 */
export interface OpenAIMediaConfig {
  auth: APIKeyAuth | APIKeyProviderAuth;
  baseURL?: string;
  organization?: string;
  timeout?: number;
  maxRetries?: number;
}

/**
 * Extended Google config for media providers (TTS, Image, Video)
 * Supports auth structure consistent with other media configs
 */
export interface GoogleMediaConfig {
  auth: APIKeyAuth;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
}

/**
 * Extended Grok config for media providers (Image, Video)
 * Uses OpenAI-compatible API at api.x.ai
 */
export interface GrokMediaConfig {
  auth: APIKeyAuth;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface OpenAIConfig extends BaseProviderConfig {
  openaiAuthMode?: 'api-key' | 'chatgpt-plan';
  apiKeyProvider?: () => Promise<string>;
  organization?: string;
  project?: string;
}

export interface AnthropicConfig extends BaseProviderConfig {
  anthropicVersion?: string;
}

export interface GoogleConfig extends BaseProviderConfig {
  // For Gemini API (ai.google.dev) - requires API key
  apiKey: string;
}

export interface VertexAIConfig extends BaseProviderConfig {
  // For Vertex AI (Google Cloud Platform)
  projectId: string;
  location: string; // e.g., 'us-central1', 'europe-west1'
  credentials?: any; // Optional: Service account JSON
  // apiKey not used - uses Application Default Credentials or credentials
}

export interface GroqConfig extends BaseProviderConfig {
  baseURL?: string; // Usually https://api.groq.com/openai/v1
}

export interface GrokConfig extends BaseProviderConfig {
  baseURL?: string; // xAI Grok API endpoint
}

export interface TogetherAIConfig extends BaseProviderConfig {
  baseURL?: string; // Usually https://api.together.xyz/v1
}

export interface GenericOpenAIConfig extends BaseProviderConfig {
  baseURL: string; // Required for generic providers
  providerName?: string; // Display name
}

export type ProviderConfig =
  | OpenAIConfig
  | AnthropicConfig
  | GoogleConfig
  | VertexAIConfig
  | GroqConfig
  | GrokConfig
  | TogetherAIConfig
  | GenericOpenAIConfig
  | BaseProviderConfig;

export interface ProvidersConfig {
  openai?: OpenAIConfig;
  anthropic?: AnthropicConfig;
  google?: GoogleConfig;
  'vertex-ai'?: VertexAIConfig;
  'google-vertex'?: VertexAIConfig; // Alias
  groq?: GroqConfig; // Groq (different from Grok)
  grok?: GrokConfig; // xAI Grok
  'together-ai'?: TogetherAIConfig;
  perplexity?: GenericOpenAIConfig;
  [key: string]: ProviderConfig | undefined;
}
