/**
 * Base provider interface
 */

export interface ProviderCapabilities {
  text: boolean;
  images: boolean;
  videos: boolean;
  audio: boolean;
  embeddings?: boolean;
  /** Optional feature flags for specific capabilities */
  features?: Record<string, boolean>;
}

export interface IProvider {
  readonly name: string;
  readonly vendor?: string;
  readonly capabilities: ProviderCapabilities;

  /**
   * Validate that the provider configuration is correct
   */
  validateConfig(): Promise<boolean>;
}
