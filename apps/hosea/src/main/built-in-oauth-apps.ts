/**
 * Built-in OAuth App Registry
 *
 * Stores default Client IDs for zero-config OAuth connections.
 * Users can click a vendor logo on the Connections page and authorize immediately
 * without needing to set up their own OAuth application.
 *
 * Override via config file: ~/.hosea/built-in-oauth-apps.json
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getHoseaDataDir } from './runtimeConfig.js';

export interface BuiltInOAuthApp {
  /** Matches vendor template ID (e.g., 'microsoft', 'twitter') */
  vendorId: string;
  /** Display name shown on Connections page */
  displayName: string;
  /** Our registered OAuth Client ID */
  clientId: string;
  /** Which auth template to use (e.g., 'oauth-user') */
  authTemplateId: string;
  /** Default scopes to request */
  scopes: string[];
  /** Extra credentials required by the vendor template (e.g., tenantId for Microsoft) */
  extraCredentials?: Record<string, string>;
  /** If true, use HTTPS callback server (port 19877) instead of HTTP (port 19876). Required by Slack etc. */
  requireHttps?: boolean;
}

/**
 * Hardcoded defaults shipped with the app.
 */
// OAuth application registrations belong to the distributor. Ship no shared secrets
// or organization-owned clients; local registrations can be supplied below.
const DEFAULT_OAUTH_APPS: BuiltInOAuthApp[] = [];

/**
 * Config file path for overrides.
 * File format: array of BuiltInOAuthApp objects.
 * If present, entries override defaults by vendorId (file wins).
 */
function getConfigPath(): string {
  return join(getHoseaDataDir(), 'built-in-oauth-apps.json');
}

/**
 * Load built-in OAuth apps, merging file overrides with hardcoded defaults.
 */
export function loadBuiltInOAuthApps(): BuiltInOAuthApp[] {
  const configPath = getConfigPath();
  let fileApps: BuiltInOAuthApp[] = [];

  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        fileApps = parsed;
      }
    } catch (error) {
      console.warn('[BuiltInOAuth] Failed to parse config file:', error);
    }
  }

  if (fileApps.length === 0) {
    return [...DEFAULT_OAUTH_APPS];
  }

  // File overrides defaults by vendorId
  const merged = new Map<string, BuiltInOAuthApp>();
  for (const app of DEFAULT_OAUTH_APPS) {
    merged.set(app.vendorId, app);
  }
  for (const app of fileApps) {
    merged.set(app.vendorId, app);
  }

  return Array.from(merged.values());
}

/**
 * Get a specific built-in OAuth app by vendor ID.
 */
export function getBuiltInOAuthApp(vendorId: string): BuiltInOAuthApp | undefined {
  const apps = loadBuiltInOAuthApps();
  return apps.find(a => a.vendorId === vendorId);
}
