/**
 * OpenAI Sora Video Generation Provider
 * Supports: sora-2, sora-2-pro
 */

import OpenAI from 'openai';
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
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderError,
} from '../../../domain/errors/AIErrors.js';

export class OpenAISoraProvider extends BaseMediaProvider implements IVideoProvider {
  readonly name: string = 'openai-video';
  readonly vendor = 'openai' as const;
  readonly capabilities: ProviderCapabilities = {
    text: false,
    images: false,
    videos: true,
    audio: false,
    features: {
      videoGeneration: true,
      imageToVideo: true,
      videoExtension: true,
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
   * Generate a video from a text prompt
   */
  async generateVideo(options: VideoGenerateOptions): Promise<VideoResponse> {
    return this.executeWithCircuitBreaker(
      async () => {
        try {
          this.logOperationStart('video.generate', {
            model: options.model,
            duration: options.duration,
            resolution: options.resolution,
          });

          const model = (options.model || 'sora-2') as
            | 'sora-2'
            | 'sora-2-pro'
            | 'sora-2-2025-10-06'
            | 'sora-2-pro-2025-10-06'
            | 'sora-2-2025-12-08';

          // Map duration to SDK's seconds parameter (string: '4', '8', '12')
          const seconds = this.durationToSeconds(options.duration || 4);

          // Build request parameters matching OpenAI SDK 6.x VideoCreateParams
          const params: {
            prompt: string;
            model?: typeof model;
            seconds?: '4' | '8' | '12';
            size?: '720x1280' | '1280x720' | '1024x1792' | '1792x1024';
            input_reference?: any;
          } = {
            prompt: options.prompt,
            model,
            seconds,
          };

          // Map resolution to SDK's size parameter
          if (options.resolution) {
            params.size = this.resolutionToSize(options.resolution);
          } else if (options.aspectRatio) {
            params.size = this.aspectRatioToSize(options.aspectRatio);
          }

          // Add image for image-to-video (input_reference)
          if (options.image) {
            params.input_reference = await this.prepareImageInput(options.image);
          }

          // Call the OpenAI Videos API
          const response = await this.client.videos.create(params);

          this.logOperationComplete('video.generate', {
            model,
            jobId: response.id,
            status: response.status,
          });

          return this.mapResponse(response);
        } catch (error: any) {
          this.handleError(error);
          throw error;
        }
      },
      'video.generate',
      { model: options.model }
    );
  }

  /**
   * Get the status of a video generation job
   */
  async getVideoStatus(jobId: string): Promise<VideoResponse> {
    return this.executeWithCircuitBreaker(
      async () => {
        try {
          this.logOperationStart('video.status', { jobId });

          const response = await this.client.videos.retrieve(jobId);

          this.logOperationComplete('video.status', {
            jobId,
            status: response.status,
            progress: response.progress,
          });

          return this.mapResponse(response);
        } catch (error: any) {
          this.handleError(error);
          throw error;
        }
      },
      'video.status',
      { jobId }
    );
  }

  /**
   * Download a completed video
   */
  async downloadVideo(jobId: string): Promise<Buffer> {
    return this.executeWithCircuitBreaker(
      async () => {
        try {
          this.logOperationStart('video.download', { jobId });

          // First check status
          const statusResponse = await this.getVideoStatus(jobId);
          if (statusResponse.status !== 'completed') {
            throw new ProviderError('openai', `Video not ready. Status: ${statusResponse.status}`);
          }

          // Use the SDK's downloadContent method
          const response = await this.client.videos.downloadContent(jobId, { variant: 'video' });

          // Convert Response to Buffer
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          this.logOperationComplete('video.download', {
            jobId,
            size: buffer.length,
          });

          return buffer;
        } catch (error: any) {
          if (error instanceof ProviderError) throw error;
          this.handleError(error);
          throw error;
        }
      },
      'video.download',
      { jobId }
    );
  }

  /**
   * Extend a completed video by generating an additional segment.
   * Calls SDK `videos.extend()` (added in openai 6.28). The `seconds`
   * parameter controls the *new* segment length, not total duration.
   *
   * `direction` is currently unused — the OpenAI Videos API extends from
   * the end of the source clip. The field is kept on `VideoExtendOptions`
   * for future provider parity.
   */
  async extendVideo(options: VideoExtendOptions): Promise<VideoResponse> {
    return this.executeWithCircuitBreaker(
      async () => {
        try {
          this.logOperationStart('video.extend', {
            model: options.model,
            extendDuration: options.extendDuration,
            direction: options.direction,
          });

          const videoId = this.requireVideoId(options.video, 'video extension');
          const seconds = this.durationToSeconds(options.extendDuration);
          const prompt = options.prompt || 'Extend this video seamlessly';

          const response = await this.client.videos.extend({
            video: { id: videoId },
            prompt,
            seconds,
          });

          this.logOperationComplete('video.extend', {
            jobId: response.id,
            status: response.status,
          });

          return this.mapResponse(response);
        } catch (error: any) {
          if (error instanceof ProviderError) throw error;
          this.handleError(error);
          throw error;
        }
      },
      'video.extend',
      { model: options.model }
    );
  }

  /**
   * Remix a completed video — same length, prompt-steered re-generation.
   */
  async remixVideo(options: VideoRemixOptions): Promise<VideoResponse> {
    return this.executeWithCircuitBreaker(
      async () => {
        try {
          this.logOperationStart('video.remix', { videoId: options.videoId });

          const response = await this.client.videos.remix(options.videoId, {
            prompt: options.prompt,
          });

          this.logOperationComplete('video.remix', {
            jobId: response.id,
            status: response.status,
          });

          return this.mapResponse(response);
        } catch (error: any) {
          this.handleError(error);
          throw error;
        }
      },
      'video.remix',
      { videoId: options.videoId }
    );
  }

  /**
   * Edit a completed video — apply a prompt-described change.
   */
  async editVideo(options: VideoEditOptions): Promise<VideoResponse> {
    return this.executeWithCircuitBreaker(
      async () => {
        try {
          this.logOperationStart('video.edit', { videoId: options.videoId });

          const response = await this.client.videos.edit({
            video: { id: options.videoId },
            prompt: options.prompt,
          });

          this.logOperationComplete('video.edit', {
            jobId: response.id,
            status: response.status,
          });

          return this.mapResponse(response);
        } catch (error: any) {
          this.handleError(error);
          throw error;
        }
      },
      'video.edit',
      { videoId: options.videoId }
    );
  }

  /**
   * Create a reusable character from a reference video (Sora character API).
   * Returns the character id, which can later be passed back to
   * `generateVideo` via `vendorOptions.characterId` (raw API plumbing —
   * the unified `VideoGenerateOptions` does not yet model character refs).
   */
  async createCharacter(options: CreateCharacterOptions): Promise<CharacterRef> {
    return this.executeWithCircuitBreaker(
      async () => {
        try {
          this.logOperationStart('video.createCharacter', { name: options.name });

          const video = await this.prepareVideoInput(options.video);
          const response = await this.client.videos.createCharacter({
            name: options.name,
            video,
          });

          this.logOperationComplete('video.createCharacter', {
            characterId: response.id,
          });

          if (!response.id) {
            throw new ProviderError(
              'openai',
              'Sora createCharacter returned no character id'
            );
          }
          return { id: response.id, name: response.name ?? options.name };
        } catch (error: any) {
          if (error instanceof ProviderError) throw error;
          this.handleError(error);
          throw error;
        }
      },
      'video.createCharacter',
      { name: options.name }
    );
  }

  /**
   * Look up an existing character by id.
   */
  async getCharacter(characterId: string): Promise<CharacterRef> {
    return this.executeWithCircuitBreaker(
      async () => {
        try {
          this.logOperationStart('video.getCharacter', { characterId });

          const response = await this.client.videos.getCharacter(characterId);

          this.logOperationComplete('video.getCharacter', { characterId });

          if (!response.id) {
            throw new ProviderError(
              'openai',
              `Sora getCharacter(${characterId}) returned no character id`
            );
          }
          return { id: response.id, name: response.name ?? '' };
        } catch (error: any) {
          if (error instanceof ProviderError) throw error;
          this.handleError(error);
          throw error;
        }
      },
      'video.getCharacter',
      { characterId }
    );
  }

  /**
   * List available video models
   */
  async listModels(): Promise<string[]> {
    return ['sora-2', 'sora-2-pro'];
  }

  /**
   * Cancel/delete a pending job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    try {
      const response = await this.client.videos.delete(jobId);
      return response.deleted;
    } catch {
      return false;
    }
  }

  /**
   * Map OpenAI SDK Video response to our VideoResponse format
   */
  private mapResponse(response: OpenAI.Videos.Video): VideoResponse {
    const result: VideoResponse = {
      jobId: response.id,
      status: this.mapStatus(response.status),
      created: response.created_at,
      progress: response.progress,
    };

    // Video completed - SDK doesn't have video URL directly,
    // use downloadContent to get the actual video
    if (response.status === 'completed') {
      result.video = {
        duration: this.secondsStringToNumber(response.seconds),
        resolution: response.size,
        format: 'mp4',
      };
    }

    if (response.status === 'failed' && response.error) {
      result.error = response.error.message || 'Video generation failed';
    }

    return result;
  }

  /**
   * Map OpenAI status to our status type
   */
  private mapStatus(status: string): 'pending' | 'processing' | 'completed' | 'failed' {
    switch (status) {
      case 'queued':
      case 'pending':
        return 'pending';
      case 'in_progress':
      case 'processing':
        return 'processing';
      case 'completed':
      case 'succeeded':
        return 'completed';
      case 'failed':
      case 'cancelled':
        return 'failed';
      default:
        return 'pending';
    }
  }

  /**
   * Convert duration number to SDK's seconds string format.
   * Rejects non-finite, non-positive, or NaN inputs — silently mapping
   * those to a default would waste a paid Sora job.
   */
  private durationToSeconds(duration: number): '4' | '8' | '12' {
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new ProviderError(
        'openai',
        `Invalid Sora duration: ${duration}. Must be a finite positive number (snapped to 4 / 8 / 12 seconds).`
      );
    }
    if (duration <= 4) return '4';
    if (duration <= 8) return '8';
    return '12';
  }

  /**
   * Convert seconds string back to number
   */
  private secondsStringToNumber(seconds: string): number {
    return parseInt(seconds, 10) || 4;
  }

  /**
   * Map resolution string to SDK's size format
   */
  private resolutionToSize(resolution: string): '720x1280' | '1280x720' | '1024x1792' | '1792x1024' {
    const validSizes = ['720x1280', '1280x720', '1024x1792', '1792x1024'] as const;
    if (validSizes.includes(resolution as any)) {
      return resolution as '720x1280' | '1280x720' | '1024x1792' | '1792x1024';
    }
    // Default to portrait
    return '720x1280';
  }

  /**
   * Map aspect ratio to SDK's size format
   */
  private aspectRatioToSize(aspectRatio: string): '720x1280' | '1280x720' | '1024x1792' | '1792x1024' {
    const map: Record<string, '720x1280' | '1280x720' | '1024x1792' | '1792x1024'> = {
      '16:9': '1280x720',
      '9:16': '720x1280',
      '9:16-tall': '1024x1792',
      '16:9-tall': '1792x1024',
    };
    return map[aspectRatio] || '720x1280';
  }

  /**
   * Prepare image input for API (input_reference)
   */
  private async prepareImageInput(image: Buffer | string): Promise<any> {
    if (Buffer.isBuffer(image)) {
      // Create a File-like object from buffer
      return new File([new Uint8Array(image)], 'input.png', { type: 'image/png' });
    }

    // If it's a file path, read it
    if (!image.startsWith('http')) {
      const fs = await import('fs');
      const data = await fs.promises.readFile(image);
      return new File([new Uint8Array(data)], 'input.png', { type: 'image/png' });
    }

    // For URLs, fetch and convert to File
    const response = await fetch(image);
    if (!response.ok) {
      throw new ProviderError(
        'openai',
        `Failed to fetch image reference (${image}): ${response.status} ${response.statusText}`
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    return new File([new Uint8Array(arrayBuffer)], 'input.png', { type: 'image/png' });
  }

  /**
   * Prepare video input for API (character creation, etc).
   * Accepts Buffer, local file path, or HTTP URL.
   */
  private async prepareVideoInput(video: Buffer | string): Promise<any> {
    if (Buffer.isBuffer(video)) {
      return new File([new Uint8Array(video)], 'input.mp4', { type: 'video/mp4' });
    }

    if (!video.startsWith('http')) {
      const fs = await import('fs');
      const path = await import('path');
      const data = await fs.promises.readFile(video);
      const filename = path.basename(video) || 'input.mp4';
      const ext = path.extname(filename).toLowerCase();
      const mime = ext === '.mov' ? 'video/quicktime' : ext === '.webm' ? 'video/webm' : 'video/mp4';
      return new File([new Uint8Array(data)], filename, { type: mime });
    }

    const response = await fetch(video);
    if (!response.ok) {
      throw new ProviderError(
        'openai',
        `Failed to fetch video reference (${video}): ${response.status} ${response.statusText}`
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    return new File([new Uint8Array(arrayBuffer)], 'input.mp4', { type: 'video/mp4' });
  }

  /**
   * Resolve a `Buffer | string` reference to a video id.
   * The Videos API references completed clips by id, not by upload — buffers
   * and URLs are rejected so the caller knows to upload first.
   */
  private requireVideoId(video: Buffer | string, op: string): string {
    if (typeof video === 'string' && !video.startsWith('http')) {
      return video;
    }
    throw new ProviderError(
      'openai',
      `Sora ${op} requires a video id (returned by generateVideo). Buffers and URLs are not supported here.`
    );
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
      if (message.includes('safety') || message.includes('policy')) {
        throw new ProviderError('openai', `Content policy violation: ${message}`);
      }
      throw new ProviderError('openai', `Bad request: ${message}`);
    }

    throw new ProviderError('openai', message);
  }
}
