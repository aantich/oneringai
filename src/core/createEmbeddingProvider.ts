/**
 * Factory function for creating embedding providers
 */

import { Connector } from './Connector.js';
import { Vendor } from './Vendor.js';
import { getVendorDefaultBaseURL } from './createProvider.js';
import type { IEmbeddingProvider } from '../domain/interfaces/IEmbeddingProvider.js';
import { OpenAIEmbeddingProvider } from '../infrastructure/providers/openai/OpenAIEmbeddingProvider.js';
import { GoogleEmbeddingProvider } from '../infrastructure/providers/google/GoogleEmbeddingProvider.js';
import { extractOpenAICompatConfig, extractGoogleConfig } from './extractProviderConfig.js';

/**
 * Create an Embedding provider from a connector
 */
export function createEmbeddingProvider(connector: Connector): IEmbeddingProvider {
  const vendor = connector.vendor;

  switch (vendor) {
    case Vendor.OpenAI:
      return new OpenAIEmbeddingProvider(extractOpenAICompatConfig(connector, 'OpenAI'));

    case Vendor.Google:
      return new GoogleEmbeddingProvider(extractGoogleConfig(connector));

    // OpenAI-compatible vendors (including Ollama with auth: none)
    case Vendor.Ollama:
    case Vendor.Groq:
    case Vendor.Together:
    case Vendor.Mistral:
    case Vendor.DeepSeek:
    case Vendor.Grok: {
      const config = extractOpenAICompatConfig(connector, vendor);
      config.baseURL = config.baseURL || getVendorDefaultBaseURL(vendor);
      return new OpenAIEmbeddingProvider(config, connector.name);
    }

    case Vendor.Custom: {
      const config = extractOpenAICompatConfig(connector, 'Custom');
      if (!config.baseURL) {
        throw new Error(
          `Connector '${connector.name}' with Custom vendor requires baseURL`
        );
      }
      return new OpenAIEmbeddingProvider(config, connector.name);
    }

    default:
      throw new Error(
        `No embedding provider available for vendor: ${vendor}. ` +
        `Supported vendors: openai, google, ollama, groq, together, mistral, deepseek, grok, custom`
      );
  }
}
