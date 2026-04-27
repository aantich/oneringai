/**
 * VideoGeneration - High-level video generation capability
 *
 * Provides a unified interface for generating videos across multiple vendors.
 * Supports text-to-video, image-to-video, and video extension.
 *
 * @example
 * ```typescript
 * import { VideoGeneration, Connector, Vendor } from '@everworker/oneringai';
 *
 * Connector.create({
 *   name: 'openai',
 *   vendor: Vendor.OpenAI,
 *   auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
 * });
 *
 * const videoGen = VideoGeneration.create({ connector: 'openai' });
 *
 * // Start video generation
 * const job = await videoGen.generate({
 *   prompt: 'A cinematic shot of a sunrise over mountains',
 *   duration: 8,
 *   resolution: '1280x720',
 * });
 *
 * // Wait for completion
 * const result = await videoGen.waitForCompletion(job.jobId);
 *
 * // Download the video
 * const videoBuffer = await videoGen.download(job.jobId);
 * ```
 */

import { Connector } from '../../core/Connector.js';
import { createVideoProvider } from '../../core/createVideoProvider.js';
import type {
  IVideoProvider,
  VideoGenerateOptions,
  VideoExtendOptions,
  VideoRemixOptions,
  VideoEditOptions,
  CreateCharacterOptions,
  CharacterRef,
  VideoResponse,
} from '../../domain/interfaces/IVideoProvider.js';
import { VIDEO_MODELS, getVideoModelInfo } from '../../domain/entities/VideoModel.js';
import { Vendor } from '../../core/Vendor.js';
import { ProviderError } from '../../domain/errors/AIErrors.js';

/**
 * Options for creating a VideoGeneration instance
 */
export interface VideoGenerationCreateOptions {
  /** Connector name or instance */
  connector: string | Connector;
}

/**
 * Simplified options for quick generation
 */
export interface SimpleVideoGenerateOptions {
  /** Text prompt describing the video */
  prompt: string;
  /** Model to use (defaults to vendor's best model) */
  model?: string;
  /** Duration in seconds */
  duration?: number;
  /** Output resolution (e.g., '1280x720', '1920x1080') */
  resolution?: string;
  /** Aspect ratio (alternative to resolution) */
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
  /** Reference image for image-to-video */
  image?: Buffer | string;
  /** Seed for reproducibility */
  seed?: number;
  /** Vendor-specific options */
  vendorOptions?: Record<string, unknown>;
}

/**
 * VideoGeneration capability class
 */
export class VideoGeneration {
  private provider: IVideoProvider;
  private connector: Connector;
  private defaultModel: string;

  private constructor(connector: Connector) {
    this.connector = connector;
    this.provider = createVideoProvider(connector);
    this.defaultModel = this.getDefaultModel();
  }

  /**
   * Create a VideoGeneration instance
   */
  static create(options: VideoGenerationCreateOptions): VideoGeneration {
    const connector =
      typeof options.connector === 'string'
        ? Connector.get(options.connector)
        : options.connector;

    if (!connector) {
      throw new Error(`Connector not found: ${options.connector}`);
    }

    return new VideoGeneration(connector);
  }

  /**
   * Generate a video from a text prompt
   * Returns a job that can be polled for completion
   */
  async generate(options: SimpleVideoGenerateOptions): Promise<VideoResponse> {
    const fullOptions: VideoGenerateOptions = {
      model: options.model || this.defaultModel,
      prompt: options.prompt,
      duration: options.duration,
      resolution: options.resolution,
      aspectRatio: options.aspectRatio,
      image: options.image,
      seed: options.seed,
      vendorOptions: options.vendorOptions,
    };

    return this.provider.generateVideo(fullOptions);
  }

  /**
   * Get the status of a video generation job
   */
  async getStatus(jobId: string): Promise<VideoResponse> {
    return this.provider.getVideoStatus(jobId);
  }

  /**
   * Wait for a video generation job to complete
   */
  async waitForCompletion(jobId: string, timeoutMs: number = 600000): Promise<VideoResponse> {
    const startTime = Date.now();
    const pollInterval = 10000; // 10 seconds

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.provider.getVideoStatus(jobId);

      if (status.status === 'completed') {
        return status;
      }

      if (status.status === 'failed') {
        throw new ProviderError(
          this.connector.vendor || 'unknown',
          `Video generation failed: ${status.error || 'Unknown error'}`
        );
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new ProviderError(
      this.connector.vendor || 'unknown',
      `Video generation timed out after ${timeoutMs}ms`
    );
  }

  /**
   * Download a completed video
   */
  async download(jobId: string): Promise<Buffer> {
    if (!this.provider.downloadVideo) {
      throw new Error(`Video download not supported by ${this.provider.name}`);
    }

    return this.provider.downloadVideo(jobId);
  }

  /**
   * Generate and wait for completion in one call
   */
  async generateAndWait(
    options: SimpleVideoGenerateOptions,
    timeoutMs: number = 600000
  ): Promise<VideoResponse> {
    const job = await this.generate(options);
    return this.waitForCompletion(job.jobId, timeoutMs);
  }

  /**
   * Extend an existing video
   * Note: Not all models/vendors support this
   */
  async extend(options: VideoExtendOptions): Promise<VideoResponse> {
    if (!this.provider.extendVideo) {
      throw new Error(`Video extension not supported by ${this.provider.name}`);
    }

    const fullOptions: VideoExtendOptions = {
      ...options,
      model: options.model || this.getExtendModel(),
    };

    return this.provider.extendVideo(fullOptions);
  }

  /**
   * Remix a completed video with a new prompt — same length,
   * prompt-steered re-generation. Provider-dependent (OpenAI Sora today).
   */
  async remix(options: VideoRemixOptions): Promise<VideoResponse> {
    if (!this.provider.remixVideo) {
      throw new Error(`Video remix not supported by ${this.provider.name}`);
    }
    return this.provider.remixVideo(options);
  }

  /**
   * Edit a completed video using a prompt-described change.
   * Provider-dependent (OpenAI Sora today).
   */
  async edit(options: VideoEditOptions): Promise<VideoResponse> {
    if (!this.provider.editVideo) {
      throw new Error(`Video edit not supported by ${this.provider.name}`);
    }
    return this.provider.editVideo(options);
  }

  /**
   * Create a reusable character from a reference video.
   * Provider-dependent (OpenAI Sora today). Returns a `CharacterRef` whose
   * `id` can be passed back via `vendorOptions.characterId` on a later
   * `generate` call.
   */
  async createCharacter(options: CreateCharacterOptions): Promise<CharacterRef> {
    if (!this.provider.createCharacter) {
      throw new Error(`Character API not supported by ${this.provider.name}`);
    }
    return this.provider.createCharacter(options);
  }

  /**
   * Look up an existing character by id. Provider-dependent.
   */
  async getCharacter(characterId: string): Promise<CharacterRef> {
    if (!this.provider.getCharacter) {
      throw new Error(`Character API not supported by ${this.provider.name}`);
    }
    return this.provider.getCharacter(characterId);
  }

  /**
   * Cancel a pending video generation job
   */
  async cancel(jobId: string): Promise<boolean> {
    if (!this.provider.cancelJob) {
      throw new Error(`Job cancellation not supported by ${this.provider.name}`);
    }

    return this.provider.cancelJob(jobId);
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
    if (vendor && VIDEO_MODELS[vendor as keyof typeof VIDEO_MODELS]) {
      return Object.values(VIDEO_MODELS[vendor as keyof typeof VIDEO_MODELS]);
    }

    return [];
  }

  /**
   * Get information about a specific model
   */
  getModelInfo(modelName: string) {
    return getVideoModelInfo(modelName);
  }

  /**
   * Get the underlying provider
   */
  getProvider(): IVideoProvider {
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
        return VIDEO_MODELS[Vendor.OpenAI].SORA_2;
      case Vendor.Google:
        return VIDEO_MODELS[Vendor.Google].VEO_3_1;
      case Vendor.Grok:
        return VIDEO_MODELS[Vendor.Grok].GROK_IMAGINE_VIDEO;
      default:
        throw new Error(`No default video model for vendor: ${vendor}`);
    }
  }

  /**
   * Get the model that supports video extension
   */
  private getExtendModel(): string {
    const vendor = this.connector.vendor;

    switch (vendor) {
      case Vendor.OpenAI:
        return VIDEO_MODELS[Vendor.OpenAI].SORA_2;
      case Vendor.Google:
        return VIDEO_MODELS[Vendor.Google].VEO_3_1;
      default:
        throw new Error(`No extend model for vendor: ${vendor}`);
    }
  }
}
