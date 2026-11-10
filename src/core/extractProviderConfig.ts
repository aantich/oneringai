/**
 * Shared config extraction helpers for media provider factories
 * Eliminates duplication across createImageProvider, createAudioProvider,
 * createVideoProvider, and createEmbeddingProvider.
 */

import { Connector } from './Connector.js';
import { Vendor } from './Vendor.js';
import { assertOpenAIAPIKeyConnector } from '../infrastructure/providers/openai/OpenAIAuth.js';
import type {
  APIKeyAuth,
  APIKeyProviderAuth,
  OpenAIMediaConfig,
  GoogleConfig,
  GoogleMediaConfig,
  GrokMediaConfig,
} from '../domain/types/ProviderConfig.js';

/**
 * Extract OpenAI/OpenAI-compatible config from connector.
 * Supports static and rotating OpenAI auth, plus none auth for local providers.
 */
export function extractOpenAICompatConfig(connector: Connector, providerLabel?: string): OpenAIMediaConfig {
  assertOpenAIAPIKeyConnector(connector, 'Media or embeddings');
  const auth = connector.config.auth;
  let resolvedAuth: APIKeyAuth | APIKeyProviderAuth;

  if (auth.type === 'api_key') {
    resolvedAuth = auth;
  } else if (auth.type === 'api_key_provider' && connector.vendor === Vendor.OpenAI) {
    resolvedAuth = {
      type: 'api_key_provider',
      getApiKey: () => connector.getToken(),
    };
  } else if (auth.type === 'none') {
    // Local providers like Ollama don't need a real key
    resolvedAuth = { type: 'api_key', apiKey: 'ollama' };
  } else {
    throw new Error(`${providerLabel ?? 'Provider'} requires API key authentication`);
  }

  const options = connector.getOptions();

  return {
    auth: resolvedAuth,
    baseURL: connector.baseURL,
    organization: options.organization as string | undefined,
    timeout: options.timeout as number | undefined,
    maxRetries: options.maxRetries as number | undefined,
  };
}

/**
 * Extract Google config (simple API key only)
 */
export function extractGoogleConfig(connector: Connector): GoogleConfig {
  const auth = connector.config.auth;

  if (auth.type !== 'api_key') {
    throw new Error('Google requires API key authentication');
  }

  return {
    apiKey: auth.apiKey,
  };
}

/**
 * Extract Google media config (with timeout/retry options)
 */
export function extractGoogleMediaConfig(connector: Connector): GoogleMediaConfig {
  const auth = connector.config.auth;

  if (auth.type !== 'api_key') {
    throw new Error('Google requires API key authentication');
  }

  const options = connector.getOptions();

  return {
    auth: {
      type: 'api_key',
      apiKey: auth.apiKey,
    },
    timeout: options.timeout as number | undefined,
    maxRetries: options.maxRetries as number | undefined,
  };
}

/**
 * Extract Grok media config
 */
export function extractGrokMediaConfig(connector: Connector): GrokMediaConfig {
  const auth = connector.config.auth;

  if (auth.type !== 'api_key') {
    throw new Error('Grok requires API key authentication');
  }

  const options = connector.getOptions();

  return {
    auth: {
      type: 'api_key',
      apiKey: auth.apiKey,
    },
    baseURL: connector.baseURL,
    timeout: options.timeout as number | undefined,
    maxRetries: options.maxRetries as number | undefined,
  };
}
