/**
 * Factory functions for creating image providers
 */

import { Connector } from './Connector.js';
import type { IImageProvider } from '../domain/interfaces/IImageProvider.js';
import { Vendor } from './Vendor.js';
import { OpenAIImageProvider } from '../infrastructure/providers/openai/OpenAIImageProvider.js';
import { GoogleImageProvider } from '../infrastructure/providers/google/GoogleImageProvider.js';
import { GrokImageProvider } from '../infrastructure/providers/grok/GrokImageProvider.js';
import { extractOpenAICompatConfig, extractGoogleConfig, extractGrokMediaConfig } from './extractProviderConfig.js';

/**
 * Create an Image Generation provider from a connector
 */
export function createImageProvider(connector: Connector): IImageProvider {
  const vendor = connector.vendor;

  switch (vendor) {
    case Vendor.OpenAI:
      return new OpenAIImageProvider(extractOpenAICompatConfig(connector, 'OpenAI'));

    case Vendor.Google:
      return new GoogleImageProvider(extractGoogleConfig(connector));

    case Vendor.Grok:
      return new GrokImageProvider(extractGrokMediaConfig(connector));

    default:
      throw new Error(
        `No Image provider available for vendor: ${vendor}. ` +
        `Supported vendors: ${Vendor.OpenAI}, ${Vendor.Google}, ${Vendor.Grok}`
      );
  }
}
