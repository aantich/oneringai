/**
 * Factory for creating video providers from connectors
 */

import { Connector } from './Connector.js';
import { Vendor } from './Vendor.js';
import type { IVideoProvider } from '../domain/interfaces/IVideoProvider.js';
import { OpenAISoraProvider } from '../infrastructure/providers/openai/OpenAISoraProvider.js';
import { GoogleVeoProvider } from '../infrastructure/providers/google/GoogleVeoProvider.js';
import { GrokImagineProvider } from '../infrastructure/providers/grok/GrokImagineProvider.js';
import { extractOpenAICompatConfig, extractGoogleMediaConfig, extractGrokMediaConfig } from './extractProviderConfig.js';

/**
 * Create a video provider from a connector
 */
export function createVideoProvider(connector: Connector): IVideoProvider {
  const vendor = connector.vendor;

  switch (vendor) {
    case Vendor.OpenAI:
      return new OpenAISoraProvider(extractOpenAICompatConfig(connector, 'OpenAI'));

    case Vendor.Google:
      return new GoogleVeoProvider(extractGoogleMediaConfig(connector));

    case Vendor.Grok:
      return new GrokImagineProvider(extractGrokMediaConfig(connector));

    default:
      throw new Error(
        `Video generation not supported for vendor: ${vendor}. ` +
          `Supported vendors: ${Vendor.OpenAI}, ${Vendor.Google}, ${Vendor.Grok}`
      );
  }
}
