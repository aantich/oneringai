import OpenAI from 'openai';
import type {
  Decision,
  DecisionCreateParams,
} from 'openai/resources/decisions.js';
import { Connector } from '../../core/Connector.js';
import { ProviderErrorMapper } from '../../infrastructure/providers/base/ProviderErrorMapper.js';

/** Connector-first access to OpenAI's ordered classification/scoring API. */
export class OpenAIDecisions {
  readonly connector: Connector;

  constructor(connector: string | Connector) {
    this.connector = typeof connector === 'string' ? Connector.get(connector) : connector;
  }

  async create(params: DecisionCreateParams): Promise<Decision> {
    if (!params.model.trim()) throw new RangeError('Decision model must not be empty');
    if (params.questions.length === 0) throw new RangeError('At least one decision question is required');
    const options = this.connector.getOptions();
    const client = new OpenAI({
      apiKey: async () => this.connector.getToken(),
      baseURL: this.connector.baseURL || undefined,
      organization: typeof options.organization === 'string' ? options.organization : undefined,
      project: typeof options.project === 'string' ? options.project : undefined,
    });
    try {
      return await client.decisions.create(params);
    } catch (error) {
      throw ProviderErrorMapper.mapError(error, { providerName: 'openai' });
    }
  }
}

export type { Decision as OpenAIDecision, DecisionCreateParams as OpenAIDecisionCreateParams };
