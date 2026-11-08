import { OAuthManager } from '../../connectors/oauth/OAuthManager.js';
import type { OAuthConfig } from '../../connectors/oauth/types.js';
export const createOAuthManager = (config: OAuthConfig): OAuthManager => new OAuthManager(config);
