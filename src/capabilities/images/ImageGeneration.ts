/**
 * ImageGeneration - High-level image generation capability
 *
 * Provides a unified interface for generating images across multiple vendors.
 *
 * @example
 * ```typescript
 * import { ImageGeneration, Connector, Vendor } from '@everworker/oneringai';
 *
 * Connector.create({
 *   name: 'openai',
 *   vendor: Vendor.OpenAI,
 *   auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
 * });
 *
 * const imageGen = ImageGeneration.create({ connector: 'openai' });
 *
 * const result = await imageGen.generate({
 *   prompt: 'A futuristic city at sunset',
 *   model: 'gpt-image-2',
 *   size: '1024x1024',
 *   quality: 'high',
 * });
 *
 * // Get base64 data
 * console.log(result.data[0].b64_json);
 * ```
 */

import { Connector } from '../../core/Connector.js';
import { createImageProvider } from '../../core/createImageProvider.js';
import type {
  IImageProvider,
  ImageGenerateOptions,
  ImageEditOptions,
  ImageVariationOptions,
  ImageResponse,
} from '../../domain/interfaces/IImageProvider.js';
import { IMAGE_MODELS, getImageModelInfo } from '../../domain/entities/ImageModel.js';
import { Vendor } from '../../core/Vendor.js';

/**
 * Options for creating an ImageGeneration instance
 */
export interface ImageGenerationCreateOptions {
  /** Connector name or instance */
  connector: string | Connector;
}

/**
 * Simplified options for quick generation
 */
export interface SimpleGenerateOptions {
  /** Text prompt describing the image */
  prompt: string;
  /** Model to use (defaults to vendor's best model) */
  model?: string;
  /** Image size */
  size?: string;
  /** Aspect ratio for providers that use ratio rather than pixel dimensions */
  aspectRatio?: string;
  /** Quality setting */
  quality?: ImageGenerateOptions['quality'];
  /** Style setting (DALL-E 3 only) */
  style?: 'vivid' | 'natural';
  /** Number of images to generate */
  n?: number;
  /** Response format */
  response_format?: 'url' | 'b64_json';
  /** Provider-specific controls such as output format, compression, or image resolution */
  vendorOptions?: Record<string, unknown>;
}

/** High-level edit options; the current vendor model is selected when omitted. */
export type SimpleImageEditOptions = Omit<ImageEditOptions, 'model'> & { model?: string };

/**
 * ImageGeneration capability class
 */
export class ImageGeneration {
  private provider: IImageProvider;
  private connector: Connector;
  private defaultModel: string;

  private constructor(connector: Connector) {
    this.connector = connector;
    this.provider = createImageProvider(connector);
    this.defaultModel = this.getDefaultModel();
  }

  /**
   * Create an ImageGeneration instance
   */
  static create(options: ImageGenerationCreateOptions): ImageGeneration {
    const connector =
      typeof options.connector === 'string'
        ? Connector.get(options.connector)
        : options.connector;

    if (!connector) {
      throw new Error(`Connector not found: ${options.connector}`);
    }

    return new ImageGeneration(connector);
  }

  /**
   * Generate images from a text prompt
   */
  async generate(options: SimpleGenerateOptions): Promise<ImageResponse> {
    const fullOptions: ImageGenerateOptions = {
      model: options.model || this.defaultModel,
      prompt: options.prompt,
      size: options.size,
      aspectRatio: options.aspectRatio,
      quality: options.quality,
      style: options.style,
      n: options.n,
      response_format: options.response_format || 'b64_json',
      vendorOptions: options.vendorOptions,
    };

    return this.provider.generateImage(fullOptions);
  }

  /**
   * Edit an existing image
   * Note: Not all models/vendors support this
   */
  async edit(options: SimpleImageEditOptions): Promise<ImageResponse> {
    if (!this.provider.editImage) {
      throw new Error(`Image editing not supported by ${this.provider.name}`);
    }

    const fullOptions: ImageEditOptions = {
      ...options,
      model: options.model || this.getEditModel(),
    };

    return this.provider.editImage(fullOptions);
  }

  /**
   * Create variations of an existing image
   * Note: Only DALL-E 2 supports this
   */
  async createVariation(options: ImageVariationOptions): Promise<ImageResponse> {
    if (!this.provider.createVariation) {
      throw new Error(`Image variations not supported by ${this.provider.name}`);
    }

    const fullOptions: ImageVariationOptions = {
      ...options,
      model: options.model || 'dall-e-2', // Only DALL-E 2 supports variations
    };

    return this.provider.createVariation(fullOptions);
  }

  /**
   * List available models for this provider
   */
  async listModels(): Promise<string[]> {
    if (this.provider.listModels) {
      return this.provider.listModels();
    }

    // Fallback to registry
    const vendor = this.connector.vendor;
    if (vendor && IMAGE_MODELS[vendor as keyof typeof IMAGE_MODELS]) {
      return Object.values(IMAGE_MODELS[vendor as keyof typeof IMAGE_MODELS]);
    }

    return [];
  }

  /**
   * Get information about a specific model
   */
  getModelInfo(modelName: string) {
    return getImageModelInfo(modelName);
  }

  /**
   * Get the underlying provider
   */
  getProvider(): IImageProvider {
    return this.provider;
  }

  /**
   * Get the current connector
   */
  getConnector(): Connector {
    return this.connector;
  }

  /**
   * Get the default model for this vendor
   */
  private getDefaultModel(): string {
    const vendor = this.connector.vendor;

    switch (vendor) {
      case Vendor.OpenAI:
        return IMAGE_MODELS[Vendor.OpenAI].GPT_IMAGE_2_5_SUNBURST;
      case Vendor.Google:
        return IMAGE_MODELS[Vendor.Google].GEMINI_NANO_BANANA_2_1;
      case Vendor.Grok:
        return IMAGE_MODELS[Vendor.Grok].GROK_IMAGINE_IMAGE_2;
      default:
        throw new Error(`No default image model for vendor: ${vendor}`);
    }
  }

  /**
   * Get the default edit model for this vendor
   */
  private getEditModel(): string {
    const vendor = this.connector.vendor;

    switch (vendor) {
      case Vendor.OpenAI:
        return IMAGE_MODELS[Vendor.OpenAI].GPT_IMAGE_2_5_SUNBURST;
      case Vendor.Google:
        return IMAGE_MODELS[Vendor.Google].GEMINI_NANO_BANANA_2_1;
      case Vendor.Grok:
        return IMAGE_MODELS[Vendor.Grok].GROK_IMAGINE_IMAGE_2;
      default:
        throw new Error(`No edit model for vendor: ${vendor}`);
    }
  }
}
