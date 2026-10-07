/**
 * Google image-generation provider for current Gemini native-image and Imagen models.
 */

import { GoogleGenAI, Modality } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';
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
  /** Gemini native image resolution. */
  imageSize?: 'auto' | '512x512' | '1024x1024' | '2048x2048' | '4096x4096'
    | '512px' | '1024px' | '2048px' | '4096px' | '512' | '1K' | '2K' | '4K';
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

          const images = this.isNativeGeminiImageModel(options.model)
            ? await this.generateNativeGeminiImages(googleOptions)
            : await this.generateImagenImages(googleOptions);

          this.logOperationComplete('image.generate', {
            model: options.model,
            imagesGenerated: images.length,
          });

          return {
            created: Math.floor(Date.now() / 1000),
            data: images.map((imageBytes) => ({ b64_json: imageBytes })),
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

          let images: string[];
          if (this.isNativeGeminiImageModel(options.model)) {
            const inputImage = await this.readImage(options.image);
            images = await this.generateNativeGeminiImages(options, inputImage);
          } else {
            const referenceImage = await this.prepareReferenceImage(options.image);
            const response = await this.client.models.editImage({
              model: options.model || 'imagen-3.0-capability-001',
              prompt: options.prompt,
              referenceImages: [referenceImage],
              config: { numberOfImages: options.n || 1 },
            });
            images = (response.generatedImages || [])
              .map((image) => image.image?.imageBytes)
              .filter((data): data is string => Boolean(data));
          }

          this.logOperationComplete('image.edit', {
            model: options.model,
            imagesGenerated: images.length,
          });

          return {
            created: Math.floor(Date.now() / 1000),
            data: images.map((imageBytes) => ({ b64_json: imageBytes })),
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
      'gemini-nano-banana-2.1',
      'gemini-3.1-flash-image',
      'gemini-3.1-flash-lite-image',
      'gemini-3-pro-image',
    ];
  }

  private isNativeGeminiImageModel(model: string): boolean {
    return model.startsWith('gemini-nano-banana-')
      || (model.startsWith('gemini-') && model.includes('-image'));
  }

  private async generateImagenImages(options: GoogleImageGenerateOptions): Promise<string[]> {
    const vendorOptions = options.vendorOptions ?? {};
    const response = await this.client.models.generateImages({
      model: options.model,
      prompt: options.prompt,
      config: {
        numberOfImages: options.n || 1,
        negativePrompt: (vendorOptions.negativePrompt as string | undefined) ?? options.negativePrompt,
        aspectRatio: (options.aspectRatio ?? vendorOptions.aspectRatio) as GoogleImageGenerateOptions['aspectRatio'],
        seed: (vendorOptions.seed as number | undefined) ?? options.seed,
        outputMimeType: (vendorOptions.outputMimeType as GoogleImageGenerateOptions['outputMimeType']) ?? options.outputMimeType,
        includeRaiReason: (vendorOptions.includeRaiReason as boolean | undefined) ?? options.includeRaiReason,
      },
    });
    return (response.generatedImages || [])
      .map((image) => image.image?.imageBytes)
      .filter((data): data is string => Boolean(data));
  }

  private async generateNativeGeminiImages(
    options: ImageGenerateOptions | ImageEditOptions,
    inputImage?: { data: string; mimeType: string }
  ): Promise<string[]> {
    const vendorOptions = options.vendorOptions ?? {};
    const imageSize = this.normalizeNativeImageSize(vendorOptions.imageSize ?? options.size ?? '1K');
    const parts: Array<Record<string, unknown>> = [{ text: options.prompt }];
    if (inputImage) {
      parts.push({ inlineData: inputImage });
    }

    // Native Gemini image models reject candidateCount > 1. Preserve the
    // unified `n` contract with one generateContent request per desired image.
    const imageCount = Math.min(4, Math.max(1, Math.trunc(options.n ?? 1)));
    const responses = await Promise.all(Array.from({ length: imageCount }, () =>
      this.client.models.generateContent({
        model: options.model,
        contents: [{ role: 'user', parts }],
        config: {
          responseModalities: [Modality.IMAGE],
          imageConfig: {
            aspectRatio: 'aspectRatio' in options
              ? options.aspectRatio ?? (vendorOptions.aspectRatio as string | undefined)
              : vendorOptions.aspectRatio as string | undefined,
            ...(imageSize ? { imageSize } : {}),
          },
        },
      })
    ));
    return responses
      .flatMap((response) => response.candidates ?? [])
      .flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.inlineData?.data)
      .filter((data): data is string => Boolean(data));
  }

  /**
   * Prepare a reference image for Google's editImage API
   */
  private async prepareReferenceImage(image: Buffer | string): Promise<any> {
    const { data: imageBytes } = await this.readImage(image);

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

  private normalizeNativeImageSize(size: unknown): '512' | '1K' | '2K' | '4K' | undefined {
    const normalized = String(size).trim().toUpperCase();
    if (normalized === 'AUTO') return undefined;
    if (['512', '512PX', '512X512'].includes(normalized)) return '512';
    if (['1K', '1024', '1024PX', '1024X1024'].includes(normalized)) return '1K';
    if (['2K', '2048', '2048PX', '2048X2048'].includes(normalized)) return '2K';
    if (['4K', '4096', '4096PX', '4096X4096'].includes(normalized)) return '4K';
    return undefined;
  }

  private async readImage(image: Buffer | string): Promise<{ data: string; mimeType: string }> {
    const bytes = Buffer.isBuffer(image) ? image : await fs.promises.readFile(image);
    return {
      data: bytes.toString('base64'),
      mimeType: this.detectImageMimeType(bytes, typeof image === 'string' ? image : undefined),
    };
  }

  private detectImageMimeType(bytes: Buffer, filename?: string): string {
    const extension = filename ? path.extname(filename).toLowerCase() : '';
    if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
    if (extension === '.png') return 'image/png';
    if (extension === '.webp') return 'image/webp';
    if (extension === '.gif') return 'image/gif';
    if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return 'image/png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    if (bytes.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
    if (bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
      return 'image/webp';
    }
    return 'application/octet-stream';
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
