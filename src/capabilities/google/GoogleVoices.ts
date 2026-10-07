import { GoogleGenAI } from '@google/genai';
import { Connector } from '../../core/Connector.js';
import { ProviderErrorMapper } from '../../infrastructure/providers/base/ProviderErrorMapper.js';

type VoicesClient = GoogleGenAI['voices'];
export type GoogleVoiceCreateParams = Parameters<VoicesClient['create']>[0];
export type GoogleVoiceListParams = Parameters<VoicesClient['list']>[0];
export type GoogleVoiceGetParams = Parameters<VoicesClient['get']>[1];
export type GoogleVoiceDeleteParams = Parameters<VoicesClient['delete']>[1];
export type GoogleVoice = Awaited<ReturnType<VoicesClient['create']>>;
export type GoogleVoiceListResponse = Awaited<ReturnType<VoicesClient['list']>>;

/** Connector-first access to Google's prebuilt, designed, and replicated voices. */
export class GoogleVoices {
  readonly connector: Connector;

  constructor(connector: string | Connector) {
    this.connector = typeof connector === 'string' ? Connector.get(connector) : connector;
  }

  async create(params: GoogleVoiceCreateParams): Promise<GoogleVoice> {
    return this.execute((client) => client.voices.create(params));
  }

  async list(params?: GoogleVoiceListParams): Promise<GoogleVoiceListResponse> {
    return this.execute((client) => client.voices.list(params));
  }

  async get(id: string, params?: GoogleVoiceGetParams): Promise<GoogleVoice> {
    if (!id.trim()) throw new RangeError('Google voice ID must not be empty');
    return this.execute((client) => client.voices.get(id, params));
  }

  async delete(id: string, params?: GoogleVoiceDeleteParams): Promise<unknown> {
    if (!id.trim()) throw new RangeError('Google voice ID must not be empty');
    return this.execute((client) => client.voices.delete(id, params));
  }

  private async execute<T>(operation: (client: GoogleGenAI) => Promise<T>): Promise<T> {
    try {
      const client = new GoogleGenAI({
        apiKey: await this.connector.getToken(),
        ...(this.connector.baseURL
          ? { httpOptions: { baseUrl: this.connector.baseURL } }
          : {}),
      });
      return await operation(client);
    } catch (error) {
      throw ProviderErrorMapper.mapError(error, { providerName: 'google' });
    }
  }
}
