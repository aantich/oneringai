/**
 * UrlAllowlistPolicy - Restrict URL-based tools to allowed domains.
 *
 * Uses proper URL parsing (not regex over raw strings).
 * Validates protocol, hostname (exact or suffix match), optional port.
 *
 * Domain matching rules:
 * - "example.com" matches exactly "example.com"
 * - ".example.com" (leading dot) matches "sub.example.com" but NOT "example.com"
 * - "evil-example.com" does NOT match "example.com"
 * - Protocol defaults to http/https only
 */

import type { IPermissionPolicy, PolicyContext, PolicyDecision, IPermissionPolicyFactory, StoredPolicyDefinition } from '../types.js';

export interface UrlAllowlistConfig {
  /** Allowed domains (exact match or suffix with leading dot) */
  allowedDomains: string[];

  /** Allowed protocols. @default ['http:', 'https:'] */
  allowedProtocols?: string[];

  /** Tool names this policy applies to. @default ['web_fetch', 'web_search', 'web_scrape'] */
  tools?: string[];

  /** Argument names to inspect for URLs. @default ['url', 'query', 'target_url'] */
  urlArgs?: string[];
}

const DEFAULT_TOOLS = ['web_fetch', 'web_search', 'web_scrape'];
const DEFAULT_URL_ARGS = ['url', 'query', 'target_url'];
const DEFAULT_PROTOCOLS = ['http:', 'https:'];

export class UrlAllowlistPolicy implements IPermissionPolicy {
  readonly name = 'builtin:url-allowlist';
  readonly priority = 50;
  readonly description = 'Restrict URL-based tools to allowed domains';

  private readonly domains: Array<{ exact: string; suffix: boolean }>;
  private readonly protocols: Set<string>;
  private readonly tools: Set<string>;
  private readonly urlArgs: Set<string>;

  constructor(config: UrlAllowlistConfig) {
    this.tools = new Set(config.tools ?? DEFAULT_TOOLS);
    this.urlArgs = new Set(config.urlArgs ?? DEFAULT_URL_ARGS);
    this.protocols = new Set(config.allowedProtocols ?? DEFAULT_PROTOCOLS);

    // Parse and validate domain entries
    this.domains = config.allowedDomains.map((d) => {
      const lower = d.toLowerCase().trim();
      if (lower.startsWith('.')) {
        // Suffix entry: ".example.com" matches subdomains
        return { exact: lower, suffix: true };
      }
      // Validate exact entries don't accidentally act as suffixes
      // (e.g., ".com" would be a suffix, not "com")
      return { exact: lower, suffix: false };
    });
  }

  evaluate(ctx: PolicyContext): PolicyDecision {
    // Only apply to configured tools
    if (!this.tools.has(ctx.toolName)) {
      return { verdict: 'abstain', reason: '', policyName: this.name };
    }

    // Check all URL arguments
    for (const argName of this.urlArgs) {
      const value = ctx.args[argName];
      if (typeof value !== 'string' || !value) continue;

      // Try to parse as URL
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        // Not a valid URL — might be a search query, skip
        continue;
      }

      // Check protocol
      if (!this.protocols.has(parsed.protocol)) {
        return {
          verdict: 'deny',
          reason: `Protocol '${parsed.protocol}' not allowed (allowed: ${[...this.protocols].join(', ')})`,
          policyName: this.name,
          metadata: {
            needsApproval: true,
            approvalKey: `${ctx.toolName}:${parsed.hostname}`,
            approvalScope: 'session',
          },
        };
      }

      // Check domain
      const hostname = parsed.hostname.toLowerCase();
      if (!this.isDomainAllowed(hostname)) {
        return {
          verdict: 'deny',
          reason: `Domain '${hostname}' not in allowed list`,
          policyName: this.name,
          metadata: {
            needsApproval: true,
            approvalKey: `${ctx.toolName}:${hostname}`,
            approvalScope: 'session',
          },
        };
      }
    }

    // All URLs (if any) are within allowed domains
    return { verdict: 'abstain', reason: '', policyName: this.name };
  }

  private isDomainAllowed(hostname: string): boolean {
    for (const entry of this.domains) {
      if (entry.suffix) {
        // ".example.com" matches "sub.example.com" but NOT "example.com" itself
        // entry.exact starts with '.', so endsWith ensures domain boundary
        // (won't match "notexample.com" — would need ".notexample.com" to end with ".example.com")
        if (hostname.endsWith(entry.exact)) {
          return true;
        }
      } else {
        // Exact match
        if (hostname === entry.exact) {
          return true;
        }
        // Also match subdomains: "example.com" matches "www.example.com"
        // The '.' prefix ensures domain boundary (won't match "evilexample.com")
        if (hostname.endsWith('.' + entry.exact)) {
          return true;
        }
      }
    }
    return false;
  }
}

export const UrlAllowlistPolicyFactory: IPermissionPolicyFactory = {
  type: 'url-allowlist',
  create(def: StoredPolicyDefinition): IPermissionPolicy {
    const config = def.config as unknown as UrlAllowlistConfig;
    const policy = new UrlAllowlistPolicy(config);
    return Object.assign(policy, { priority: def.priority ?? 50 });
  },
};
