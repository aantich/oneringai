/**
 * Grok (xAI) Image Generation Provider
 * Uses OpenAI-compatible API at api.x.ai
 * Supports: grok-imagine-image
 */

import OpenAI from 'openai';
import * as fs from 'fs';
import { BaseMediaProvider } from '../base/BaseMediaProvider.js';
import type {
  IImageProvider,
  ImageGenerateOptions,
  ImageEditOptions,
  ImageResponse,
} from '../../../domain/interfaces/IImageProvider.js';
import type { ProviderCapabilities } from '../../../domain/interfaces/IProvider.js';
import type { GrokMediaConfig } from '../../../domain/types/ProviderConfig.js';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderError,
} from '../../../domain/errors/AIErrors.js';

const GROK_API_BASE_URL = 'https://api.x.ai/v1';

export class GrokImageProvider extends BaseMediaProvider implements IImageProvider {
  readonly name: string = 'grok-image';
  readonly vendor = 'grok' as const;
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

  constructor(config: GrokMediaConfig) {
    super({ apiKey: config.auth.apiKey, ...config });

    this.client = new OpenAI({
      apiKey: config.auth.apiKey,
      baseURL: config.baseURL || GROK_API_BASE_URL,
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

          // xAI API uses aspect_ratio instead of size, and doesn't support quality
          const params: any = {
            model: options.model || 'grok-imagine-image',
            prompt: options.prompt,
            n: options.n || 1,
            response_format: options.response_format || 'b64_json',
          };

          // Add aspect_ratio if provided (xAI uses aspect_ratio, not size)
          if (options.aspectRatio) {
            params.aspect_ratio = options.aspectRatio;
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
          throw error;
        }
      },
      'image.generate',
      { model: options.model }
    );
  }

  /**
   * Edit an existing image with a prompt
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

          const params: any = {
            model: options.model || 'grok-imagine-image',
            image,
            prompt: options.prompt,
            mask,
            size: options.size as any,
            n: options.n || 1,
            response_format: options.response_format || 'b64_json',
          };

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
   * List available image models
   */
  async listModels(): Promise<string[]> {
    return ['grok-imagine-image'];
  }

  /**
   * Prepare image input (Buffer or file path) for API.
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
   * Handle API errors
   */
  private handleError(error: any): never {
    const message = error.message || 'Unknown Grok API error';
    const status = error.status;

    if (status === 401) {
      throw new ProviderAuthError('grok', 'Invalid API key');
    }

    if (status === 429) {
      throw new ProviderRateLimitError('grok', message);
    }

    if (status === 400) {
      if (message.includes('safety') || message.includes('policy')) {
        throw new ProviderError('grok', `Content policy violation: ${message}`);
      }
      throw new ProviderError('grok', `Bad request: ${message}`);
    }

    throw new ProviderError('grok', message);
  }
}
