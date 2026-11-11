/**
 * Google Veo Video Generation Provider
 * Supports: veo-2.0, veo-3.0, veo-3.0-fast, veo-3.1
 */

import { GoogleGenAI } from '@google/genai';
import { BaseMediaProvider } from '../base/BaseMediaProvider.js';
import type {
  IVideoProvider,
  VideoGenerateOptions,
  VideoExtendOptions,
  VideoEditOptions,
  VideoResponse,
  VideoStatus,
} from '../../../domain/interfaces/IVideoProvider.js';
import type { ProviderCapabilities } from '../../../domain/interfaces/IProvider.js';
import type { GoogleMediaConfig } from '../../../domain/types/ProviderConfig.js';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderError,
} from '../../../domain/errors/AIErrors.js';
import { detectImageFormat, fetchImageAsBase64 } from '../../../utils/imageUtils.js';

/**
 * Google Veo-specific options
 */
export interface GoogleVeoOptions {
  /** Negative prompt (what to avoid) */
  negativePrompt?: string;
  /** Last frame image for interpolation */
  lastFrame?: Buffer | string;
  /** Person generation mode */
  personGeneration?: 'dont_allow' | 'allow_adult' | 'allow_all';
  /** Safety filter level */
  safetyFilterLevel?: 'block_low_and_above' | 'block_medium_and_above' | 'block_only_high';
}

export class GoogleVeoProvider extends BaseMediaProvider implements IVideoProvider {
  readonly name: string = 'google-video';
  readonly vendor = 'google' as const;
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

  private client: GoogleGenAI;
  private pendingOperations: Map<string, any> = new Map();

  constructor(config: GoogleMediaConfig) {
    super({ apiKey: config.auth.apiKey, ...config });

    this.client = new GoogleGenAI({
      apiKey: config.auth.apiKey,
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

          const model = options.model || 'veo-3.1-generate-preview';
          if (model === 'gemini-omni-flash-preview' || model === 'gemini-omni-1.1-flash' || model === 'gemini-omni-1.2-flash') {
            return await this.generateOmniVideo(options);
          }
          const googleOptions = (options.vendorOptions || {}) as GoogleVeoOptions;

          // Build config
          const config: any = {};

          // Aspect ratio
          if (options.aspectRatio) {
            config.aspectRatio = options.aspectRatio;
          }

          // Resolution
          if (options.resolution) {
            config.resolution = options.resolution;
          }

          // Duration - must be a number, not string
          if (options.duration) {
            config.durationSeconds = options.duration;
          }

          // Seed
          if (options.seed !== undefined) {
            config.seed = options.seed;
          }

          // Negative prompt
          if (googleOptions.negativePrompt) {
            config.negativePrompt = googleOptions.negativePrompt;
          }

          // Person generation setting
          if (googleOptions.personGeneration) {
            config.personGeneration = googleOptions.personGeneration;
          }

          // Safety filter level
          if (googleOptions.safetyFilterLevel) {
            config.safetyFilterLevel = googleOptions.safetyFilterLevel;
          }

          // Build request
          const request: any = {
            model,
            prompt: options.prompt,
            config,
          };

          // Add image for image-to-video
          if (options.image) {
            request.image = await this.prepareImageInput(options.image);
          }

          // Add last frame if specified
          if (googleOptions.lastFrame) {
            request.lastFrame = await this.prepareImageInput(googleOptions.lastFrame);
          }

          // Start video generation (returns an operation)
          const operation = await (this.client.models as any).generateVideos(request);

          // Store operation for polling
          const jobId = this.extractJobId(operation);
          this.pendingOperations.set(jobId, operation);

          this.logOperationComplete('video.generate', {
            model,
            jobId,
            status: 'pending',
          });

          return {
            jobId,
            status: 'pending',
            created: Math.floor(Date.now() / 1000),
          };
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

          // Get stored operation
          let operation = this.pendingOperations.get(jobId);

          if (operation?.kind === 'omni') {
            return operation.response;
          }

          if (!operation) {
            // Try to retrieve by operation name
            try {
              operation = await (this.client as any).operations.getVideosOperation({
                operation: { name: jobId },
              });
            } catch {
              throw new ProviderError('google', `Video job not found: ${jobId}`);
            }
          }

          // Poll for status update
          operation = await (this.client as any).operations.getVideosOperation({
            operation,
          });

          // Update stored operation
          this.pendingOperations.set(jobId, operation);

          const response = this.mapResponse(jobId, operation);

          this.logOperationComplete('video.status', {
            jobId,
            status: response.status,
          });

          // Note: Don't clean up here - downloadVideo() needs the operation
          // Cleanup happens in downloadVideo() after successful download

          return response;
        } catch (error: any) {
          if (error instanceof ProviderError) throw error;
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

          // Get status to ensure completion
          const status = await this.getVideoStatus(jobId);
          if (status.status !== 'completed') {
            throw new ProviderError('google', `Video not ready. Status: ${status.status}`);
          }

          // Get the operation
          const operation = this.pendingOperations.get(jobId);
          if (operation?.kind === 'omni') {
            const encoded = operation.response.video?.b64_json;
            if (!encoded) throw new ProviderError('google', 'No Gemini Omni video data available');
            this.pendingOperations.delete(jobId);
            return Buffer.from(encoded, 'base64');
          }
          if (!operation?.response?.generatedVideos?.[0]?.video) {
            throw new ProviderError('google', 'No video available for download');
          }

          const video = operation.response.generatedVideos[0].video;
          let buffer: Buffer;

          // Option 1: Check if videoBytes is available directly (base64)
          if (video.videoBytes) {
            buffer = Buffer.from(video.videoBytes, 'base64');
          }
          // Option 2: Use files.download() with a temp file
          else if (video.uri) {
            const fs = await import('fs/promises');
            const os = await import('os');
            const path = await import('path');

            // Create temp file path
            const tempDir = os.tmpdir();
            const tempFile = path.join(tempDir, `veo-${Date.now()}.mp4`);

            try {
              // Download to temp file using SDK
              await this.client.files.download({
                file: { video }, // Pass as GeneratedVideo
                downloadPath: tempFile,
              });

              // Read temp file into buffer
              buffer = await fs.readFile(tempFile);

              // Clean up temp file
              await fs.unlink(tempFile).catch(() => {});
            } catch (downloadError: any) {
              // Clean up temp file on error
              await fs.unlink(tempFile).catch(() => {});
              throw new ProviderError(
                'google',
                `Failed to download video: ${downloadError.message}`
              );
            }
          } else {
            throw new ProviderError(
              'google',
              'No videoBytes or uri available for download'
            );
          }

          this.logOperationComplete('video.download', {
            jobId,
            size: buffer.length,
          });

          // Clean up after successful download
          this.pendingOperations.delete(jobId);

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
   * Extend an existing video (Veo 3.1 supports this)
   */
  async extendVideo(options: VideoExtendOptions): Promise<VideoResponse> {
    return this.executeWithCircuitBreaker(
      async () => {
        try {
          this.logOperationStart('video.extend', {
            model: options.model,
            extendDuration: options.extendDuration,
          });

          const model = options.model || 'veo-3.1-generate-preview';

          // Video extension in Veo is done by providing the last frame
          // of the existing video and generating a continuation
          const request: any = {
            model,
            prompt: options.prompt || 'Continue the video seamlessly',
            config: {
              durationSeconds: String(options.extendDuration),
            },
          };

          // Extract last frame from video or use video as input
          if (Buffer.isBuffer(options.video)) {
            // For buffer input, we'd need to extract the last frame
            // This is a simplified implementation
            request.image = {
              imageBytes: options.video.toString('base64'),
            };
          } else {
            request.video = { uri: options.video };
          }

          const operation = await (this.client.models as any).generateVideos(request);

          const jobId = this.extractJobId(operation);
          this.pendingOperations.set(jobId, operation);

          this.logOperationComplete('video.extend', {
            jobId,
            status: 'pending',
          });

          return {
            jobId,
            status: 'pending',
            created: Math.floor(Date.now() / 1000),
          };
        } catch (error: any) {
          this.handleError(error);
          throw error;
        }
      },
      'video.extend',
      { model: options.model }
    );
  }

  /** Conversational edit for a Gemini Omni interaction ID. */
  async editVideo(options: VideoEditOptions): Promise<VideoResponse> {
    return this.executeWithCircuitBreaker(async () => {
      try {
        const interaction = await (this.client.interactions as any).create({
          model: options.model || 'gemini-omni-1.1-flash',
          previous_interaction_id: options.videoId,
          input: options.prompt,
          response_format: { type: 'video' },
        });
        return this.storeOmniResponse(interaction);
      } catch (error: any) {
        this.handleError(error);
        throw error;
      }
    }, 'video.edit', { model: options.model || 'gemini-omni-1.1-flash' });
  }

  /**
   * List available video models
   */
  async listModels(): Promise<string[]> {
    return [
      'veo-2.0-generate-001',
      'veo-3.1-fast-generate-preview',
      'veo-3.1-generate-preview',
      'veo-3.1-lite-generate-preview',
      'gemini-omni-1.2-flash',
      'gemini-omni-1.1-flash',
      'gemini-omni-flash-preview',
    ];
  }

  private async generateOmniVideo(options: VideoGenerateOptions): Promise<VideoResponse> {
    const vendor = options.vendorOptions ?? {};
    const input: unknown = options.image
      ? [
          { type: 'image', ...await this.prepareOmniImageInput(options.image) },
          { type: 'text', text: options.prompt },
        ]
      : options.prompt;
    const interaction = await (this.client.interactions as any).create({
      model: options.model || 'gemini-omni-1.1-flash',
      input,
      response_format: {
        ...((vendor.responseFormat as Record<string, unknown> | undefined) ?? {}),
        type: 'video',
        aspect_ratio: options.aspectRatio,
        ...(options.duration === undefined ? {} : { duration: `${options.duration}s` }),
      },
      generation_config: {
        video_config: {
          ...((vendor.videoConfig as Record<string, unknown> | undefined) ?? {}),
          task: options.image ? 'image_to_video' : 'text_to_video',
        },
      },
    });
    return this.storeOmniResponse(interaction);
  }

  private storeOmniResponse(interaction: any): VideoResponse {
    const jobId = interaction.id ?? `omni-${Date.now()}`;
    const videoData = interaction.output_video?.data;
    if (!videoData) {
      throw new ProviderError('google', 'Gemini Omni returned no video output');
    }
    const response: VideoResponse = {
      jobId,
      status: 'completed',
      created: Math.floor(Date.now() / 1000),
      progress: 100,
      video: { b64_json: videoData, resolution: '720p', format: 'mp4' },
    };
    this.pendingOperations.set(jobId, { kind: 'omni', response });
    return response;
  }

  /**
   * Wait for video completion with polling
   */
  async waitForCompletion(jobId: string, timeoutMs: number = 600000): Promise<VideoResponse> {
    const startTime = Date.now();
    const pollInterval = 10000; // 10 seconds

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getVideoStatus(jobId);

      if (status.status === 'completed' || status.status === 'failed') {
        return status;
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new ProviderError('google', `Video generation timed out after ${timeoutMs}ms`);
  }

  /**
   * Extract job ID from operation
   */
  private extractJobId(operation: any): string {
    if (operation.name) {
      return operation.name;
    }
    // Generate a unique ID if not available
    return `veo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Prepare image input for API
   */
  private async prepareImageInput(image: Buffer | string): Promise<any> {
    if (Buffer.isBuffer(image)) {
      return {
        imageBytes: image.toString('base64'),
      };
    }

    // Check if it's a URL or file path
    if (image.startsWith('http://') || image.startsWith('https://')) {
      return { imageUri: image };
    }

    // Read from file path
    const fs = await import('fs/promises');
    const data = await fs.readFile(image);
    return {
      imageBytes: data.toString('base64'),
    };
  }

  /** Interactions image blocks require inline data plus the actual source MIME type. */
  private async prepareOmniImageInput(image: Buffer | string): Promise<{
    data: string;
    mime_type: string;
  }> {
    if (Buffer.isBuffer(image)) {
      const data = image.toString('base64');
      return { data, mime_type: detectImageFormat(data) };
    }
    if (/^(?:https?:|data:image\/)/.test(image)) {
      const fetched = await fetchImageAsBase64(image);
      return { data: fetched.base64Data, mime_type: fetched.mimeType.split(';')[0]! };
    }
    const fs = await import('fs/promises');
    const bytes = await fs.readFile(image);
    const data = bytes.toString('base64');
    return { data, mime_type: detectImageFormat(data) };
  }

  /**
   * Map operation to VideoResponse
   */
  private mapResponse(jobId: string, operation: any): VideoResponse {
    const result: VideoResponse = {
      jobId,
      status: this.mapStatus(operation),
      created: Math.floor(Date.now() / 1000),
    };

    if (operation.done && operation.response?.generatedVideos?.[0]) {
      const video = operation.response.generatedVideos[0];
      result.video = {
        duration: video.video?.duration,
        format: 'mp4',
      };

      // URL may be available through the file reference
      if (video.video?.uri) {
        result.video.url = video.video.uri;
      }
    }

    if (operation.error) {
      result.error = operation.error.message || 'Video generation failed';
      result.status = 'failed';
    }

    return result;
  }

  /**
   * Map operation status to our status type
   */
  private mapStatus(operation: any): VideoStatus {
    if (operation.error) {
      return 'failed';
    }
    if (operation.done) {
      return 'completed';
    }
    if (operation.metadata?.state === 'ACTIVE' || operation.metadata?.state === 'PROCESSING') {
      return 'processing';
    }
    return 'pending';
  }

  /**
   * Handle Google API errors
   */
  private handleError(error: any): never {
    const message = error.message || 'Unknown Google API error';
    const status = error.status || error.code;

    if (status === 401 || status === 403 || message.includes('API key')) {
      throw new ProviderAuthError('google', 'Invalid API key');
    }

    if (status === 429 || message.includes('quota') || message.includes('rate')) {
      throw new ProviderRateLimitError('google', message);
    }

    if (status === 400) {
      if (message.includes('safety') || message.includes('blocked')) {
        throw new ProviderError('google', `Content policy violation: ${message}`);
      }
      throw new ProviderError('google', `Bad request: ${message}`);
    }

    throw new ProviderError('google', message);
  }
}
