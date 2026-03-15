/**
 * Google Imagen Image Generation provider
 * Supports: imagen-3.0-generate-002, imagen-3.0-fast-generate-001, imagen-3.0-capability-001
 */

import { GoogleGenAI } from '@google/genai';
import { BaseMediaProvider } from '../base/BaseMediaProvider.js';
import type {
  IImageProvider,
  ImageGenerateOptions,
  ImageEditOptions,
  ImageResponse,
} from '../../../domain/interfaces/IImageProvider.js';
import type { ProviderCapabilities } from '../../../domain/interfaces/IProvider.js';
import type { GoogleConfig } from '../../../domain/types/ProviderConfig.js';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderError,
} from '../../../domain/errors/AIErrors.js';

/**
 * Extended options for Google image generation
 */
export interface GoogleImageGenerateOptions extends ImageGenerateOptions {
  /** Negative prompt - what to avoid */
  negativePrompt?: string;
  /** Aspect ratio (1:1, 3:4, 4:3, 9:16, 16:9) */
  aspectRatio?: '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
  /** Random seed for reproducible generation */
  seed?: number;
  /** Output MIME type */
  outputMimeType?: 'image/png' | 'image/jpeg';
  /** Include safety filter reason in response */
  includeRaiReason?: boolean;
}

export class GoogleImageProvider extends BaseMediaProvider implements IImageProvider {
  readonly name: string = 'google-image';
  readonly vendor = 'google' as const;
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

  private client: GoogleGenAI;

  constructor(config: GoogleConfig) {
    super(config);

    this.client = new GoogleGenAI({
      apiKey: config.apiKey,
    });
  }

  /**
   * Generate images from a text prompt using Google Imagen
   */
  async generateImage(options: ImageGenerateOptions): Promise<ImageResponse> {
    return this.executeWithCircuitBreaker(
      async () => {
        try {
          this.logOperationStart('image.generate', {
            model: options.model,
            n: options.n,
          });

          const googleOptions = options as GoogleImageGenerateOptions;

          const response = await this.client.models.generateImages({
            model: options.model,
            prompt: options.prompt,
            config: {
              numberOfImages: options.n || 1,
              negativePrompt: googleOptions.negativePrompt,
              aspectRatio: googleOptions.aspectRatio,
              seed: googleOptions.seed,
              outputMimeType: googleOptions.outputMimeType,
              includeRaiReason: googleOptions.includeRaiReason,
            },
          });

          const images = response.generatedImages || [];

          this.logOperationComplete('image.generate', {
            model: options.model,
            imagesGenerated: images.length,
          });

          return {
            created: Math.floor(Date.now() / 1000),
            data: images.map((img: any) => ({
              b64_json: img.image?.imageBytes,
              // Google doesn't provide URLs, only base64
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
   * Edit an existing image using Imagen capability model
   * Uses imagen-3.0-capability-001
   */
  async editImage(options: ImageEditOptions): Promise<ImageResponse> {
    return this.executeWithCircuitBreaker(
      async () => {
        try {
          this.logOperationStart('image.edit', {
            model: options.model,
            n: options.n,
          });

          // Prepare the reference image
          const referenceImage = await this.prepareReferenceImage(options.image);

          const response = await this.client.models.editImage({
            model: options.model || 'imagen-3.0-capability-001',
            prompt: options.prompt,
            referenceImages: [referenceImage],
            config: {
              numberOfImages: options.n || 1,
            },
          });

          const images = response.generatedImages || [];

          this.logOperationComplete('image.edit', {
            model: options.model,
            imagesGenerated: images.length,
          });

          return {
            created: Math.floor(Date.now() / 1000),
            data: images.map((img: any) => ({
              b64_json: img.image?.imageBytes,
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
    return [
      'imagen-4.0-generate-001',
      'imagen-4.0-ultra-generate-001',
      'imagen-4.0-fast-generate-001',
    ];
  }

  /**
   * Prepare a reference image for Google's editImage API
   */
  private async prepareReferenceImage(image: Buffer | string): Promise<any> {
    let imageBytes: string;

    if (Buffer.isBuffer(image)) {
      imageBytes = image.toString('base64');
    } else {
      // It's a file path - read and convert
      const fs = await import('fs');
      const buffer = await fs.promises.readFile(image);
      imageBytes = buffer.toString('base64');
    }

    // Return a subject reference image structure
    return {
      referenceImage: {
        image: {
          imageBytes,
        },
      },
      referenceType: 'REFERENCE_TYPE_SUBJECT',
    };
  }

  /**
   * Handle Google API errors
   */
  private handleError(error: any): never {
    const message = error.message || 'Unknown Google API error';
    const status = error.status || error.code;

    if (status === 401 || message.includes('API key not valid')) {
      throw new ProviderAuthError('google', 'Invalid API key');
    }

    if (status === 429 || message.includes('Resource exhausted')) {
      throw new ProviderRateLimitError('google', message);
    }

    if (status === 400) {
      // Check for safety-related errors
      if (
        message.includes('SAFETY') ||
        message.includes('blocked') ||
        message.includes('Responsible AI')
      ) {
        throw new ProviderError('google', `Content policy violation: ${message}`);
      }
      throw new ProviderError('google', `Bad request: ${message}`);
    }

    throw new ProviderError('google', message);
  }
}
