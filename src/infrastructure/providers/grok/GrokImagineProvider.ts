/**
 * Grok (xAI) Imagine Video Generation Provider
 * Implements async job-based video generation via direct HTTP calls
 * Based on xAI API Reference: https://docs.x.ai/docs/api-reference#video-generation
 * Supports: grok-imagine-video
 */

import { BaseMediaProvider } from '../base/BaseMediaProvider.js';
import type {
  IVideoProvider,
  VideoGenerateOptions,
  VideoResponse,
} from '../../../domain/interfaces/IVideoProvider.js';
import type { ProviderCapabilities } from '../../../domain/interfaces/IProvider.js';
import type { GrokMediaConfig } from '../../../domain/types/ProviderConfig.js';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderError,
} from '../../../domain/errors/AIErrors.js';

const GROK_API_BASE_URL = 'https://api.x.ai/v1';

/**
 * xAI video generation request (POST /v1/videos/generations)
 * Based on actual API spec
 */
interface GrokVideoRequest {
  prompt: string;
  model?: string | null;
  duration?: number | null; // Range: 1-15, default: 6
  aspect_ratio?: string | null;
  resolution?: string | null;
  size?: string | null;
  image?: { url: string; detail?: string | null } | null;
  output?: { upload_url: string } | null;
  user?: string | null;
}

/**
 * xAI video generation response (POST /v1/videos/generations)
 */
interface GrokVideoCreateResponse {
  request_id: string;
}

/**
 * xAI video status response (GET /v1/videos/{request_id})
 *
 * When pending: { status: 'pending' }
 * When complete: { video: { url, duration, respect_moderation }, model: string }
 * (no 'status' field when complete - presence of 'video' indicates completion)
 */
interface GrokVideoStatusResponse {
  // Only present when job is still pending
  status?: 'pending';
  // Present when job is complete
  model?: string;
  video?: {
    url: string;
    duration: number;
    respect_moderation: boolean;
  };
}

export class GrokImagineProvider extends BaseMediaProvider implements IVideoProvider {
  readonly name: string = 'grok-video';
  readonly vendor = 'grok' as const;
  readonly capabilities: ProviderCapabilities = {
    text: false,
    images: false,
    videos: true,
    audio: false,
    features: {
      videoGeneration: true,
      imageToVideo: true,
    },
  };

  private apiKey: string;
  private baseURL: string;
  private timeout: number;

  constructor(config: GrokMediaConfig) {
    super({ apiKey: config.auth.apiKey, ...config });

    this.apiKey = config.auth.apiKey;
    this.baseURL = config.baseURL || GROK_API_BASE_URL;
    this.timeout = config.timeout || 60000;
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
            aspectRatio: options.aspectRatio,
          });

          const request: GrokVideoRequest = {
            prompt: options.prompt,
            model: options.model || 'grok-imagine-video',
            duration: options.duration || 6,
          };

          // Handle aspect ratio
          if (options.aspectRatio) {
            request.aspect_ratio = options.aspectRatio;
          }

          // Handle resolution
          if (options.resolution) {
            request.resolution = options.resolution;
          }

          // Handle image-to-video - xAI expects { url: "..." } object
          if (options.image) {
            const imageUrl = await this.prepareImageUrl(options.image);
            request.image = { url: imageUrl };
          }

          const response = await this.makeRequest<GrokVideoCreateResponse>(
            'POST',
            '/videos/generations',
            request
          );

          this.logOperationComplete('video.generate', {
            model: options.model,
            jobId: response.request_id,
          });

          // Initial response only has request_id - return as pending job
          return {
            jobId: response.request_id,
            status: 'pending' as const,
            created: Date.now(),
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

          const response = await this.makeRequest<GrokVideoStatusResponse>(
            'GET',
            `/videos/${jobId}`
          );

          this.logOperationComplete('video.status', {
            jobId,
            status: response.video ? 'done' : response.status || 'pending',
            hasVideo: !!response.video?.url,
          });

          return this.mapStatusResponse(response, jobId);
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
            throw new ProviderError('grok', `Video not ready. Status: ${statusResponse.status}`);
          }

          if (!statusResponse.video?.url) {
            throw new ProviderError('grok', 'No video URL available');
          }

          // Download the video
          const response = await fetch(statusResponse.video.url);
          if (!response.ok) {
            throw new ProviderError('grok', `Failed to download video: ${response.statusText}`);
          }

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
   * List available video models
   */
  async listModels(): Promise<string[]> {
    return ['grok-imagine-video'];
  }

  /**
   * Cancel a pending video generation job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    try {
      await this.makeRequest('DELETE', `/videos/${jobId}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Make HTTP request to xAI API
   */
  private async makeRequest<T>(
    method: string,
    endpoint: string,
    body?: any
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'application/json',
      };

      // Only add Content-Type for requests with body
      if (body) {
        headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        // xAI may return error in different formats
        const errorMessage = errorBody.error?.message || errorBody.message || errorBody.detail || JSON.stringify(errorBody) || `HTTP ${response.status}`;
        const error = new Error(errorMessage);
        (error as any).status = response.status;
        (error as any).body = errorBody;
        throw error;
      }

      return response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Map xAI status response to our VideoResponse format
   *
   * xAI API response format:
   * - Pending: { status: 'pending' }
   * - Complete: { video: { url, duration, respect_moderation }, model: string }
   *   (no 'status' field when complete)
   */
  private mapStatusResponse(response: GrokVideoStatusResponse, jobId: string): VideoResponse {
    // Map xAI status to our status
    let status: 'pending' | 'processing' | 'completed' | 'failed';

    // Presence of video object indicates completion
    if (response.video) {
      // Check if moderation blocked the video
      if (response.video.respect_moderation === false) {
        status = 'failed';
      } else if (response.video.url) {
        status = 'completed';
      } else {
        status = 'failed';
      }
    } else {
      // No video = still processing
      status = 'processing';
    }

    const result: VideoResponse = {
      jobId,
      status,
      created: Date.now(),
    };

    // Add video data if completed
    if (status === 'completed' && response.video) {
      result.video = {
        url: response.video.url,
        duration: response.video.duration,
        format: 'mp4',
      };
    }

    // Add error if moderation blocked
    if (response.video?.respect_moderation === false) {
      result.error = 'Video blocked by content moderation';
    }

    return result;
  }

  /**
   * Prepare image URL for image-to-video
   * xAI expects image.url - can be http(s) URL or data URL
   */
  private async prepareImageUrl(image: Buffer | string): Promise<string> {
    // If it's a Buffer, convert to data URL
    if (Buffer.isBuffer(image)) {
      const base64 = image.toString('base64');
      return `data:image/png;base64,${base64}`;
    }

    // If it's already a URL (http or data URL), use as-is
    if (image.startsWith('http') || image.startsWith('data:')) {
      return image;
    }

    // If it's a file path, read and convert to data URL
    const fs = await import('fs');
    const data = await fs.promises.readFile(image);
    const base64 = data.toString('base64');
    // Try to detect image type from extension
    const ext = image.split('.').pop()?.toLowerCase() || 'png';
    const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
    return `data:${mimeType};base64,${base64}`;
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
      if (message.includes('safety') || message.includes('policy') || message.includes('moderation')) {
        throw new ProviderError('grok', `Content policy violation: ${message}`);
      }
      throw new ProviderError('grok', `Bad request: ${message}`);
    }

    if (status === 422) {
      throw new ProviderError('grok', `Validation error: ${message}`);
    }

    if (status === 404) {
      throw new ProviderError('grok', `Not found: ${message}`);
    }

    throw new ProviderError('grok', message);
  }
}
