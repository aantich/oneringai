/**
 * Compatibility provider for the retired OpenAI Videos API.
 *
 * @deprecated OpenAI retired Sora 2 and the Videos API on 2026-09-24 with no
 * replacement. Public methods remain available for existing integrations, but
 * reject locally without creating SDK clients, reading files, or making requests.
 */

import { BaseMediaProvider } from '../base/BaseMediaProvider.js';
import type {
  IVideoProvider,
  VideoGenerateOptions,
  VideoExtendOptions,
  VideoRemixOptions,
  VideoEditOptions,
  CreateCharacterOptions,
  CharacterRef,
  VideoResponse,
} from '../../../domain/interfaces/IVideoProvider.js';
import type { ProviderCapabilities } from '../../../domain/interfaces/IProvider.js';
import type { OpenAIMediaConfig } from '../../../domain/types/ProviderConfig.js';
import { resolveOpenAIBaseProviderKey } from './OpenAIAuth.js';
import { ProviderError } from '../../../domain/errors/AIErrors.js';

export class OpenAISoraProvider extends BaseMediaProvider implements IVideoProvider {
  readonly name: string = 'openai-video';
  readonly vendor = 'openai' as const;
  readonly capabilities: ProviderCapabilities = {
    text: false,
    images: false,
    videos: false,
    audio: false,
    features: {
      videoGeneration: false,
      imageToVideo: false,
      videoExtension: false,
    },
  };

  constructor(config: OpenAIMediaConfig) {
    super({ apiKey: resolveOpenAIBaseProviderKey(config), ...config });
  }

  async generateVideo(_options: VideoGenerateOptions): Promise<VideoResponse> {
    throw this.retirementError();
  }

  async getVideoStatus(_jobId: string): Promise<VideoResponse> {
    throw this.retirementError();
  }

  async downloadVideo(_jobId: string): Promise<Buffer> {
    throw this.retirementError();
  }

  async extendVideo(_options: VideoExtendOptions): Promise<VideoResponse> {
    throw this.retirementError();
  }

  async remixVideo(_options: VideoRemixOptions): Promise<VideoResponse> {
    throw this.retirementError();
  }

  async editVideo(_options: VideoEditOptions): Promise<VideoResponse> {
    throw this.retirementError();
  }

  async createCharacter(_options: CreateCharacterOptions): Promise<CharacterRef> {
    throw this.retirementError();
  }

  async getCharacter(_characterId: string): Promise<CharacterRef> {
    throw this.retirementError();
  }

  async listModels(): Promise<string[]> {
    return [];
  }

  /** No remote cancellation is possible; preserve the existing boolean result. */
  async cancelJob(_jobId: string): Promise<boolean> {
    return false;
  }

  private retirementError(): ProviderError {
    return new ProviderError(
      'openai',
      'The OpenAI Videos API (Sora 2 and Sora 2 Pro) was retired on 2026-09-24. ' +
        'OpenAI lists no replacement; configure a Google or Grok video connector.',
      410
    );
  }
}
