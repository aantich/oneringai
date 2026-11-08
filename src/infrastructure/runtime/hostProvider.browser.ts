import { InvalidConfigError } from '../../domain/errors/AIErrors.js';
import type { VertexAIConfig } from '../../domain/types/ProviderConfig.js';
import type { ITextProvider } from '../../domain/interfaces/ITextProvider.js';
export function createVertexProvider(_config: VertexAIConfig): ITextProvider {
  throw new InvalidConfigError('Vertex ADC/environment credential acquisition requires a Node host; use the existing supported browser connector or provider-injection path');
}
