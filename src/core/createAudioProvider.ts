/**
 * Factory functions for creating audio providers (TTS and STT)
 */

import { Connector } from './Connector.js';
import type { ITextToSpeechProvider } from '../domain/interfaces/IAudioProvider.js';
import type { ISpeechToTextProvider } from '../domain/interfaces/IAudioProvider.js';
import { Vendor } from './Vendor.js';
import { OpenAITTSProvider } from '../infrastructure/providers/openai/OpenAITTSProvider.js';
import { OpenAISTTProvider } from '../infrastructure/providers/openai/OpenAISTTProvider.js';
import { GoogleTTSProvider } from '../infrastructure/providers/google/GoogleTTSProvider.js';
import { extractOpenAICompatConfig, extractGoogleConfig } from './extractProviderConfig.js';

/**
 * Create a Text-to-Speech provider from a connector
 */
export function createTTSProvider(connector: Connector): ITextToSpeechProvider {
  const vendor = connector.vendor;

  switch (vendor) {
    case Vendor.OpenAI:
      return new OpenAITTSProvider(extractOpenAICompatConfig(connector, 'OpenAI'));

    case Vendor.Google:
      return new GoogleTTSProvider(extractGoogleConfig(connector));

    default:
      throw new Error(
        `No TTS provider available for vendor: ${vendor}. ` +
        `Supported vendors: ${Vendor.OpenAI}, ${Vendor.Google}`
      );
  }
}

/**
 * Create a Speech-to-Text provider from a connector
 */
export function createSTTProvider(connector: Connector): ISpeechToTextProvider {
  const vendor = connector.vendor;

  switch (vendor) {
    case Vendor.OpenAI:
      return new OpenAISTTProvider(extractOpenAICompatConfig(connector, 'OpenAI'));

    case Vendor.Groq:
      // TODO: Implement GroqSTTProvider (Whisper on Groq)
      throw new Error(`Groq STT provider not yet implemented`);

    case Vendor.Google:
      // TODO: Implement GoogleSTTProvider
      throw new Error(`Google STT provider not yet implemented`);

    default:
      throw new Error(
        `No STT provider available for vendor: ${vendor}. ` +
        `Supported vendors: ${Vendor.OpenAI}, ${Vendor.Groq}`
      );
  }
}
