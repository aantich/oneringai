import { InvalidConfigError } from '../../domain/errors/AIErrors.js';
import type { OAuthManager } from '../../connectors/oauth/OAuthManager.js';
import type { OAuthConfig } from '../../connectors/oauth/types.js';
export function createOAuthManager(_config: OAuthConfig): OAuthManager {
  throw new InvalidConfigError('OAuth/JWT credential acquisition requires a Node host; configure browser credentials through the existing API-key, no-auth or provider-injection interfaces');
}
