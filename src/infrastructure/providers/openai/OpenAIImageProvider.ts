/**
 * OpenAI Image Generation provider
 * Supports: gpt-image-1, dall-e-3, dall-e-2
 */

import OpenAI from 'openai';
import * as fs from 'fs';
import { BaseMediaProvider } from '../base/BaseMediaProvider.js';
import type {
  IImageProvider,
  ImageGenerateOptions,
  ImageEditOptions,
  ImageVariationOptions,
  ImageResponse,
} from '../../../domain/interfaces/IImageProvider.js';
import type { ProviderCapabilities } from '../../../domain/interfaces/IProvider.js';
import type { OpenAIMediaConfig } from '../../../domain/types/ProviderConfig.js';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderError,
} from '../../../domain/errors/AIErrors.js';

export class OpenAIImageProvider extends BaseMediaProvider implements IImageProvider {
  readonly name: string = 'openai-image';
  readonly vendor = 'openai' as const;
  readonly capabilities: ProviderCapabilities = {
    text: false,
    images: true,
    videos: false,
    audio: false,
    features: {
      imageGeneration: true,
      imageEditing: true,
    },
  };

  private client: OpenAI;

  constructor(config: OpenAIMediaConfig) {
    super({ apiKey: config.auth.apiKey, ...config });

    this.client = new OpenAI({
      apiKey: config.auth.apiKey,
      baseURL: config.baseURL,
      organization: config.organization,
      timeout: config.timeout,
      maxRetries: config.maxRetries,
    });
  }

  /**
   * Generate images from a text prompt
   */
  async generateImage(options: ImageGenerateOptions): Promise<ImageResponse> {
    return this.executeWithCircuitBreaker(
      async () => {
        try {
          this.logOperationStart('image.generate', {
            model: options.model,
            size: options.size,
            quality: options.quality,
            n: options.n,
          });

          // gpt-image-1 doesn't support response_format parameter
          const isGptImage = options.model === 'gpt-image-1';

          const params: any = {
            model: options.model,
            prompt: options.prompt,
            size: options.size as any,
            quality: options.quality,
            style: options.style,
            n: options.n || 1,
          };

          // Only add response_format for models that support it
          if (!isGptImage) {
            params.response_format = options.response_format || 'b64_json';
          }

          const response = await this.client.images.generate(params);

          const data = response.data || [];

          this.logOperationComplete('image.generate', {
            model: options.model,
            imagesGenerated: data.length,
          });

          return {
            created: response.created,
            data: data.map((img) => ({
              url: img.url,
              b64_json: img.b64_json,
              revised_prompt: img.revised_prompt,
            })),
          };
        } catch (error: any) {
          this.handleError(error);
          throw error; // TypeScript needs this
        }
      },
      'image.generate',
      { model: options.model }
    );
  }

  /**
   * Edit an existing image with a prompt
   * Supported by: gpt-image-1, dall-e-2
   */
  async editImage(options: ImageEditOptions): Promise<ImageResponse> {
    return this.executeWithCircuitBreaker(
      async () => {
        try {
          this.logOperationStart('image.edit', {
            model: options.model,
            size: options.size,
            n: options.n,
          });

          // Prepare the image - handle both Buffer and file path
          const image = this.prepareImageInput(options.image);
          const mask = options.mask ? this.prepareImageInput(options.mask) : undefined;

          // gpt-image-1 doesn't support response_format parameter
          const isGptImage = options.model === 'gpt-image-1';

          const params: any = {
            model: options.model,
            image,
            prompt: options.prompt,
            mask,
            size: options.size as any,
            n: options.n || 1,
          };

          // Only add response_format for models that support it
          if (!isGptImage) {
            params.response_format = options.response_format || 'b64_json';
          }

          const response = await this.client.images.edit(params);

          const data = response.data || [];

          this.logOperationComplete('image.edit', {
            model: options.model,
            imagesGenerated: data.length,
          });

          return {
            created: response.created,
            data: data.map((img) => ({
              url: img.url,
              b64_json: img.b64_json,
              revised_prompt: img.revised_prompt,
            })),
          };
        } catch (error: any) {
          this.handleError(error);
          throw error;
        }
      },
      'image.edit',
      { model: options.model }
    );
  }

  /**
   * Create variations of an existing image
   * Supported by: dall-e-2 only
   */
  async createVariation(options: ImageVariationOptions): Promise<ImageResponse> {
    return this.executeWithCircuitBreaker(
      async () => {
        try {
          this.logOperationStart('image.variation', {
            model: options.model,
            size: options.size,
            n: options.n,
          });

          // Prepare the image
          const image = this.prepareImageInput(options.image);

          const response = await this.client.images.createVariation({
            model: options.model,
            image,
            size: options.size as any,
            n: options.n || 1,
            response_format: options.response_format || 'b64_json',
          });

          const data = response.data || [];

          this.logOperationComplete('image.variation', {
            model: options.model,
            imagesGenerated: data.length,
          });

          return {
            created: response.created,
            data: data.map((img) => ({
              url: img.url,
              b64_json: img.b64_json,
              revised_prompt: img.revised_prompt,
            })),
          };
        } catch (error: any) {
          this.handleError(error);
          throw error;
        }
      },
      'image.variation',
      { model: options.model }
    );
  }

  /**
   * List available image models
   */
  async listModels(): Promise<string[]> {
    return ['gpt-image-1', 'dall-e-3', 'dall-e-2'];
  }

  /**
   * Prepare image input (Buffer or file path) for OpenAI API.
   *
   * Buffer is passed directly to File — wrapping in `new Uint8Array(buf)`
   * would copy the payload before File snapshots it.
   */
  private prepareImageInput(image: Buffer | string): any {
    if (Buffer.isBuffer(image)) {
      return new File([image as BlobPart], 'image.png', { type: 'image/png' });
    }

    // It's a file path - create a readable stream
    return fs.createReadStream(image);
  }

  /**
   * Handle OpenAI API errors
   */
  private handleError(error: any): never {
    const message = error.message || 'Unknown OpenAI API error';
    const status = error.status;

    if (status === 401) {
      throw new ProviderAuthError('openai', 'Invalid API key');
    }

    if (status === 429) {
      throw new ProviderRateLimitError('openai', message);
    }

    if (status === 400) {
      // Check for specific image-related errors
      if (message.includes('safety system')) {
        throw new ProviderError('openai', `Content policy violation: ${message}`);
      }
      throw new ProviderError('openai', `Bad request: ${message}`);
    }

    throw new ProviderError('openai', message);
  }
}
