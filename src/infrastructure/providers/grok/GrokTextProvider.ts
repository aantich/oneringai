import type { AdvancedTextCapabilities } from '../../../domain/interfaces/IAdvancedInference.js';
import { getModelInfo } from '../../../domain/entities/Model.js';
import {
  GenericOpenAIProvider,
  type GenericOpenAIConfig,
} from '../generic/GenericOpenAIProvider.js';

/**
 * xAI's text API uses the OpenAI Responses wire format, but its hosted tools,
 * reasoning replay requirements, and billing metadata are vendor-specific.
 */
export class GrokTextProvider extends GenericOpenAIProvider {
  protected override readonly nativeToolVendor = 'grok' as const;

  constructor(name: string, config: GenericOpenAIConfig) {
    super(name, config, { text: true, images: true, audio: false, videos: false });
  }

  override getAdvancedCapabilities(model: string): AdvancedTextCapabilities {
    const info = getModelInfo(model);
    const supportsStructuredOutput = info?.features.structuredOutput === true;
    const supportsPromptCaching = info?.features.promptCaching === true;
    const supportsResponses = info?.isActive === true && info.endpoints?.includes('responses') === true;
    const nativeTools: AdvancedTextCapabilities['nativeTools'] = supportsResponses
      ? [...(info.features.nativeTools ?? [])]
      : [];

    return {
      reasoningHistory: 'always',
      promptCaching: {
        mode: supportsPromptCaching ? 'implicit' : 'unsupported',
        ttlModes: supportsPromptCaching ? ['short'] : [],
        reportsCacheUsage: supportsPromptCaching,
      },
      batch: { supported: false, cancellable: false },
      structuredOutput: {
        jsonObject: supportsStructuredOutput ? 'native' : 'prompt',
        jsonSchema: supportsStructuredOutput ? 'native' : 'prompt',
        nativeWithTools: supportsStructuredOutput,
      },
      nativeTools,
      nativeToolOptions: { remoteMcpApproval: false },
      dataHandling: {
        promptCaching: supportsPromptCaching ? 'provider_managed' : 'none',
        batch: 'none',
        remoteMcp: 'none',
      },
    };
  }
}
