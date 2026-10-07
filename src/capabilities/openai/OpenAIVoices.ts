import OpenAI from 'openai';
import { Connector } from '../../core/Connector.js';
import { ProviderErrorMapper } from '../../infrastructure/providers/base/ProviderErrorMapper.js';

export type OpenAIVoice = Awaited<ReturnType<OpenAI['audio']['voices']['create']>>;
export type OpenAIVoiceCreateParams = Parameters<OpenAI['audio']['voices']['create']>[0];

/** Connector-first creation of prompt-designed and consent-based OpenAI voices. */
export class OpenAIVoices {
  readonly connector: Connector;

  constructor(connector: string | Connector) {
    this.connector = typeof connector === 'string' ? Connector.get(connector) : connector;
  }

  async create(params: OpenAIVoiceCreateParams): Promise<OpenAIVoice> {
    const options = this.connector.getOptions();
    const client = new OpenAI({
      apiKey: async () => this.connector.getToken(),
      baseURL: this.connector.baseURL || undefined,
      organization: typeof options.organization === 'string' ? options.organization : undefined,
      project: typeof options.project === 'string' ? options.project : undefined,
    });
    try {
      return await client.audio.voices.create(params);
    } catch (error) {
      throw ProviderErrorMapper.mapError(error, { providerName: 'openai' });
    }
  }
}
