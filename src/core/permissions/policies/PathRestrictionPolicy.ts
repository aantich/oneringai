/**
 * PathRestrictionPolicy - Restrict file operations to allowed paths.
 *
 * Inspects file path arguments and denies if they resolve outside allowed roots.
 * Uses canonicalized absolute paths (resolves `..`, normalizes separators).
 * Best-effort symlink awareness when the file exists.
 *
 * Only applies to configured tools (default: filesystem tools).
 * Returns `abstain` for non-matching tools.
 */

import { resolve, normalize } from 'path';
import { realpathSync } from 'fs';
import type { IPermissionPolicy, PolicyContext, PolicyDecision, IPermissionPolicyFactory, StoredPolicyDefinition } from '../types.js';

export interface PathRestrictionConfig {
  /** Allowed path prefixes (will be canonicalized at construction) */
  allowedPaths: string[];

  /** Tool names this policy applies to */
  tools?: string[];

  /** Argument names to inspect for file paths */
  pathArgs?: string[];

  /** Whether to resolve symlinks for existing files. @default true */
  resolveSymlinks?: boolean;

  /** Base path for resolving relative paths. @default process.cwd() */
  basePath?: string;
}

const DEFAULT_TOOLS = [
  'write_file', 'edit_file', 'read_file', 'list_directory', 'glob', 'grep',
];

const DEFAULT_PATH_ARGS = [
  'path', 'file_path', 'target_path', 'directory', 'pattern',
];

export class PathRestrictionPolicy implements IPermissionPolicy {
  readonly name = 'builtin:path-restriction';
  readonly priority = 50;
  readonly description = 'Restrict file operations to allowed directory roots';

  private readonly allowedRoots: string[];
  private readonly tools: Set<string>;
  private readonly pathArgs: Set<string>;
  private readonly resolveSymlinks: boolean;
  private readonly basePath: string;

  constructor(config: PathRestrictionConfig) {
    this.basePath = config.basePath ?? process.cwd();
    this.resolveSymlinks = config.resolveSymlinks ?? true;
    this.tools = new Set(config.tools ?? DEFAULT_TOOLS);
    this.pathArgs = new Set(config.pathArgs ?? DEFAULT_PATH_ARGS);

    // Canonicalize allowed paths at construction
    this.allowedRoots = config.allowedPaths.map((p) => this.canonicalize(p));
  }

  evaluate(ctx: PolicyContext): PolicyDecision {
    // Only apply to configured tools
    if (!this.tools.has(ctx.toolName)) {
      return { verdict: 'abstain', reason: '', policyName: this.name };
    }

    // Extract and check all path arguments
    for (const argName of this.pathArgs) {
      const value = ctx.args[argName];
      if (typeof value !== 'string' || !value) continue;

      const canonPath = this.canonicalize(value);

      if (!this.isWithinAllowedRoots(canonPath)) {
        return {
          verdict: 'deny',
          reason: `Path '${value}' is outside allowed directories`,
          policyName: this.name,
          metadata: {
            needsApproval: true,
            approvalKey: `${ctx.toolName}:${canonPath}`,
            approvalScope: 'session',
            resolvedPath: canonPath,
          },
        };
      }
    }

    // All paths (if any) are within allowed roots
    return { verdict: 'abstain', reason: '', policyName: this.name };
  }

  /**
   * Canonicalize a path: resolve relative, normalize, optionally resolve symlinks.
   */
  private canonicalize(inputPath: string): string {
    // Resolve relative paths against basePath
    let resolved = resolve(this.basePath, inputPath);
    resolved = normalize(resolved);

    // Best-effort symlink resolution for existing paths
    if (this.resolveSymlinks) {
      try {
        resolved = realpathSync(resolved);
      } catch {
        // File doesn't exist yet — use the resolved path as-is
      }
    }

    return resolved;
  }

  /**
   * Check if a canonical path is within any allowed root.
   */
  private isWithinAllowedRoots(canonPath: string): boolean {
    // Normalize to forward slashes for consistent comparison across platforms
    const normalizedPath = canonPath.replace(/\\/g, '/');
    for (const root of this.allowedRoots) {
      const normalizedRoot = root.replace(/\\/g, '/');
      // Path must be the root itself or start with root + separator
      if (normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + '/')) {
        return true;
      }
    }
    return false;
  }
}

export const PathRestrictionPolicyFactory: IPermissionPolicyFactory = {
  type: 'path-restriction',
  create(def: StoredPolicyDefinition): IPermissionPolicy {
    const config = def.config as unknown as PathRestrictionConfig;
    const policy = new PathRestrictionPolicy(config);
    return Object.assign(policy, { priority: def.priority ?? 50 });
  },
};
