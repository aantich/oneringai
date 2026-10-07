/**
 * Image generation provider interface
 */

import { IProvider } from './IProvider.js';

export interface ImageGenerateOptions {
  model: string;
  prompt: string;
  size?: string;
  aspectRatio?: string; // e.g., '16:9', '4:3' - used by xAI and Google
  quality?: 'standard' | 'hd' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto';
  style?: 'vivid' | 'natural';
  n?: number; // Number of images to generate
  response_format?: 'url' | 'b64_json';
  /** Provider-specific options for features without a normalized equivalent. */
  vendorOptions?: Record<string, unknown>;
}

export interface ImageEditOptions {
  model: string;
  image: Buffer | string; // Buffer or file path
  prompt: string;
  mask?: Buffer | string;
  size?: string;
  n?: number;
  response_format?: 'url' | 'b64_json';
  /** Provider-specific options for features without a normalized equivalent. */
  vendorOptions?: Record<string, unknown>;
}

export interface ImageVariationOptions {
  model: string;
  image: Buffer | string;
  n?: number;
  size?: string;
  response_format?: 'url' | 'b64_json';
}

export interface ImageResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
    /** Persistent provider file ID, when output storage was requested. */
    file_id?: string;
    /** Persistent public URL, when requested from the provider. */
    public_url?: string;
  }>;
}

export interface IImageProvider extends IProvider {
  /**
   * Generate images from text prompt
   */
  generateImage(options: ImageGenerateOptions): Promise<ImageResponse>;

  /**
   * Edit an existing image (optional - not all providers support)
   */
  editImage?(options: ImageEditOptions): Promise<ImageResponse>;

  /**
   * Create variations of an image (optional)
   */
  createVariation?(options: ImageVariationOptions): Promise<ImageResponse>;

  /**
   * List available models
   */
  listModels?(): Promise<string[]>;
}
