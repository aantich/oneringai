/**
 * OpenAI Image Generation provider
 * Supports GPT Image generation and editing; retired DALL-E operations fail locally.
 */

import OpenAI from 'openai';
import * as fs from 'fs';
import { getImageModelsByVendor } from '../../../domain/entities/ImageModel.js';
import { Vendor } from '../../../core/Vendor.js';
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
import { resolveOpenAIBaseProviderKey, resolveOpenAISDKAPIKey } from './OpenAIAuth.js';
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
    super({ apiKey: resolveOpenAIBaseProviderKey(config), ...config });

    this.client = new OpenAI({
      apiKey: resolveOpenAISDKAPIKey(config),
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
    this.assertModelAvailable(options.model);
    this.assertModelAvailable(options.vendorOptions?.model);

    return this.executeWithCircuitBreaker(
      async () => {
        try {
          this.logOperationStart('image.generate', {
            model: options.model,
            size: options.size,
            quality: options.quality,
            n: options.n,
          });

          const isGptImage = options.model.startsWith('gpt-image-')
            || options.model === 'chatgpt-image-latest';
          const vendorOptions = options.vendorOptions ?? {};
          const normalizedQuality = isGptImage
            ? options.quality === 'standard'
              ? 'medium'
              : options.quality === 'hd'
                ? 'high'
                : options.quality
            : options.quality;

          const params: any = {
            model: options.model,
            prompt: options.prompt,
            size: options.size as any,
            quality: normalizedQuality,
            n: options.n || 1,
            ...vendorOptions,
          };

          if (!isGptImage) params.style = options.style;

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
   * Supported by GPT Image models. DALL-E 2 was retired on 2026-05-12.
   */
  async editImage(options: ImageEditOptions): Promise<ImageResponse> {
    this.assertModelAvailable(options.model);
    this.assertModelAvailable(options.vendorOptions?.model);

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

          const isGptImage = options.model.startsWith('gpt-image-')
            || options.model === 'chatgpt-image-latest';

          const params: any = {
            model: options.model,
            image,
            prompt: options.prompt,
            mask,
            size: options.size as any,
            n: options.n || 1,
            ...options.vendorOptions,
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
   * @deprecated The DALL-E 2 variations endpoint was retired on 2026-05-12.
   * Use editImage() with a GPT Image model and an explicit variation prompt.
   */
  async createVariation(_options: ImageVariationOptions): Promise<ImageResponse> {
    throw new ProviderError(
      'openai',
      'Image variations are unavailable: DALL-E 2 was retired on 2026-05-12. ' +
        'Use edit() / editImage() with a GPT Image model and a prompt describing the desired variation.',
      410
    );
  }

  /**
   * List available image models
   */
  async listModels(): Promise<string[]> {
    return getImageModelsByVendor(Vendor.OpenAI).map((model) => model.name);
  }

  private assertModelAvailable(model: unknown): void {
    if (model === 'dall-e-2' || model === 'dall-e-3') {
      throw new ProviderError(
        'openai',
        `${model} was retired on 2026-05-12. Use a GPT Image model for image generation or editing.`,
        410
      );
    }
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
