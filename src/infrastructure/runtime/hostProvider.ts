import { VertexAITextProvider } from '../providers/vertex/VertexAITextProvider.js';
import type { VertexAIConfig } from '../../domain/types/ProviderConfig.js';
import type { ITextProvider } from '../../domain/interfaces/ITextProvider.js';
export function createVertexProvider(config: VertexAIConfig): ITextProvider { return new VertexAITextProvider(config); }
