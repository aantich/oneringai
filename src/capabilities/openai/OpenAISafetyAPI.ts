import { assertOpenAIAPIKeyConnector } from '../../infrastructure/providers/openai/OpenAIAuth.js';
import OpenAI from 'openai';
import type { SafetyAlert } from 'openai/resources/safety/alerts.js';
import { Connector } from '../../core/Connector.js';
import { ProviderErrorMapper } from '../../infrastructure/providers/base/ProviderErrorMapper.js';

/** Connector-first access to OpenAI safety-alert records. */
export class OpenAISafetyAPI {
  readonly connector: Connector;

  constructor(connector: string | Connector) {
    this.connector = typeof connector === 'string' ? Connector.get(connector) : connector;
    assertOpenAIAPIKeyConnector(this.connector, 'OpenAISafetyAPI');
  }

  async retrieveAlert(id: string): Promise<SafetyAlert> {
    if (!id.trim()) throw new RangeError('Safety alert ID must not be empty');
    const options = this.connector.getOptions();
    const client = new OpenAI({
      apiKey: async () => this.connector.getToken(),
      baseURL: this.connector.baseURL || undefined,
      organization: typeof options.organization === 'string' ? options.organization : undefined,
      project: typeof options.project === 'string' ? options.project : undefined,
    });
    try {
      return await client.safety.alerts.retrieve(id);
    } catch (error) {
      throw ProviderErrorMapper.mapError(error, { providerName: 'openai' });
    }
  }
}

export type OpenAISafetyAlert = SafetyAlert;

